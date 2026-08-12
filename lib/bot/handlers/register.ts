import type { BotInstance } from '@/lib/bot/chat';
import { flowEngine } from '@/lib/bot/flows/flow-engine';
import { getThreadLocaleFromState } from '@/lib/bot/flows/flow-locale';
import { flowRegistry } from '@/lib/bot/flows/flow-registry';
import type {
  Flow,
  FlowData,
  FlowThreadState,
} from '@/lib/bot/flows/flow-types';
import {
  fetchIncidentTypeNames,
  fetchResidentIncidentStatuses,
} from '@/lib/bot/flows/incident-reporting-service';
import { classifyChatIntent } from '@/lib/bot/flows/intent-classifier';
import {
  DEFAULT_LOCALE,
  localizeIncidentSeverity,
  localizeIncidentStatus,
  resolveResidentLocale,
  translate,
} from '@/lib/bot/i18n';
import type { ResidentLocale } from '@/lib/bot/i18n/types';
import { renderIdleCommandCard } from '@/lib/bot/renderers/card-renderer';
import type { BotThread } from '@/lib/bot/types';
import { postWithRetry } from '@/lib/bot/utils/post-with-retry';
import { formatRelativeTime } from '@/lib/date';
import { toPoint } from '@/lib/geo';
import { createDefaultGeocodingService } from '@/lib/geocoding';
import { createAdminClient } from '@/lib/supabase/admin';

const geocodingService = createDefaultGeocodingService();

interface IdleCommands {
  guidedReportCommand: string;
  quickReportCommand: string;
  profileCommand: string;
  statusCommand: string;
}

/**
 * Register message handlers for the bot.
 */
export function registerMessageHandlers(bot: BotInstance) {
  function normalizeText(input: unknown): string {
    return typeof input === 'string' ? input.trim().toLowerCase() : '';
  }

  function getIdleCommands(): IdleCommands {
    return {
      guidedReportCommand:
        flowRegistry.get('incident-reporting')?.start?.commands?.[0] ??
        'report',
      quickReportCommand:
        flowRegistry.get('incident-reporting-freeform')?.start?.commands?.[2] ??
        flowRegistry.get('incident-reporting-freeform')?.start?.commands?.[0] ??
        'quick report',
      profileCommand:
        flowRegistry.get('resident-thread-settings')?.start?.commands?.[0] ??
        'settings',
      statusCommand: 'status',
    };
  }

  const STATUS_QUERY_COMMANDS = new Set([
    'status',
    'report status',
    'report statuses',
    'incident status',
    'my report',
    'my reports',
  ]);

  function getDateTimeLocale(locale: ResidentLocale): string {
    if (locale === 'fil') {
      return 'fil-PH';
    }

    if (locale === 'hil') {
      return 'en-PH';
    }

    return 'en-PH';
  }

  async function handleReportStatusQuery(
    thread: BotThread,
    input: unknown,
    locale: ResidentLocale
  ): Promise<boolean> {
    const normalizedInput = normalizeText(input);
    if (!STATUS_QUERY_COMMANDS.has(normalizedInput)) {
      return false;
    }

    try {
      const statuses = await fetchResidentIncidentStatuses(thread, 5);

      if (statuses.length === 0) {
        await postWithRetry(thread, translate('incident.status.empty', locale));
        return true;
      }

      const dateLocale = getDateTimeLocale(locale);
      const rows = statuses.map((item) => {
        const statusLabel = localizeIncidentStatus(item.status, locale);
        const severityLabel = localizeIncidentSeverity(item.severity, locale);
        const updatedPrefix = translate(
          'incident.status.updated_prefix',
          locale
        );
        const updatedLabel = formatRelativeTime(item.updatedAt, dateLocale);

        return [
          item.incidentTypeName,
          `${statusLabel} (${severityLabel})`,
          `${updatedPrefix} ${updatedLabel}`,
        ].join(' | ');
      });

      await postWithRetry(
        thread,
        [
          translate('incident.status.title', locale),
          ...rows.map((row) => `- ${row}`),
        ].join('\n')
      );

      return true;
    } catch (error) {
      console.error('Error fetching report statuses:', error);
      await postWithRetry(
        thread,
        error instanceof Error
          ? error.message
          : translate('handler.error', locale)
      );
      return true;
    }
  }

  async function getResidentByThreadId(thread: BotThread): Promise<{
    id: string;
  } | null> {
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from('residents')
      .select('id')
      .eq('thread_id', thread.id)
      .maybeSingle();

    if (error) {
      console.error('Supabase error checking resident:', error);
      throw new Error('An error occurred while checking your profile.');
    }

    return data;
  }

  async function postAvailableCommandHint(
    thread: BotThread,
    locale: ResidentLocale = DEFAULT_LOCALE
  ): Promise<void> {
    const {
      guidedReportCommand,
      quickReportCommand,
      profileCommand,
      statusCommand,
    } = getIdleCommands();

    await renderIdleCommandCard(thread, {
      title: translate('handler.start.hint_intro', locale),
      options: [
        {
          command: guidedReportCommand,
          description: translate(
            'handler.start.option_guided_report_desc',
            locale
          ),
        },
        {
          command: quickReportCommand,
          description: translate(
            'handler.start.option_quick_report_desc',
            locale
          ),
        },
        {
          command: profileCommand,
          description: translate('handler.start.option_profile_desc', locale),
        },
        {
          command: statusCommand,
          description: translate('handler.start.option_status_desc', locale),
        },
      ],
    });
  }

  async function resolveThreadLocale(
    thread: BotThread
  ): Promise<ResidentLocale> {
    const cachedLocale = await getThreadLocaleFromState(thread);
    if (cachedLocale) {
      return cachedLocale;
    }

    return resolveResidentLocale(thread.id);
  }

  async function startFlow(
    thread: BotThread,
    flow: Flow,
    context: { hasResident: boolean },
    visitedFlowIds: Set<string> = new Set(),
    prefillData?: FlowData
  ): Promise<boolean> {
    const locale = await resolveThreadLocale(thread);

    if (visitedFlowIds.has(flow.id)) {
      console.error(`Detected cyclic flow fallback while starting ${flow.id}`);
      await postWithRetry(thread, translate('error.flow.cyclic', locale));
      return false;
    }

    visitedFlowIds.add(flow.id);

    if (flow.start?.requiresResident && !context.hasResident) {
      if (flow.start.missingResidentMessageKey) {
        await postWithRetry(
          thread,
          translate(flow.start.missingResidentMessageKey, locale)
        );
      } else if (flow.start.missingResidentMessage) {
        await postWithRetry(thread, flow.start.missingResidentMessage);
      }

      const fallbackFlowId = flow.start.fallbackFlowId;
      if (!fallbackFlowId) {
        return false;
      }

      const fallbackFlow = flowRegistry.get(fallbackFlowId);
      if (!fallbackFlow) {
        console.error(`Fallback flow not registered: ${fallbackFlowId}`);
        await postWithRetry(
          thread,
          translate('error.flow.start_error', locale)
        );
        return false;
      }

      return startFlow(thread, fallbackFlow, context, visitedFlowIds);
    }

    if (flow.onStart) {
      await flow.onStart(thread);
    }

    const initialState: FlowThreadState = prefillData
      ? flowEngine.createPrefilledState(flow.id, 1, locale, prefillData)
      : flowEngine.createInitialState(flow.id, 1, locale);
    await thread.setState(initialState);
    await flowEngine.renderCurrentStep(thread, flow, initialState);
    return true;
  }

  /**
   * Classify a free-text message and auto-route it
   * when no command matched and no flow is active.
   * This is a convenience layer only.
   */
  async function handleIntentClassification(
    thread: BotThread,
    userText: string,
    context: { hasResident: boolean },
    locale: ResidentLocale
  ): Promise<boolean> {
    if (!userText.trim()) {
      return false;
    }

    const allowedIncidentTypeNames = await fetchIncidentTypeNames().catch(
      (error) => {
        console.error(
          'Failed to load incident types for intent classification:',
          error
        );
        return [];
      }
    );

    const classified = await classifyChatIntent({
      text: userText,
      allowedIncidentTypeNames,
    });

    if (classified.intent === 'status') {
      return handleReportStatusQuery(thread, 'status', locale);
    }

    if (classified.intent === 'settings') {
      const settingsFlow = flowRegistry.get('resident-thread-settings');
      if (!settingsFlow) {
        return false;
      }
      return startFlow(thread, settingsFlow, context);
    }

    if (classified.intent === 'incident_report') {
      const incidentFlow = flowRegistry.get('incident-reporting');
      if (!incidentFlow) {
        return false;
      }

      const prefillData: FlowData = {};
      if (classified.incidentTypeName) {
        prefillData.incidentTypeName = classified.incidentTypeName;
      }
      if (classified.severity) {
        prefillData.severity = classified.severity;
      }
      if (classified.description) {
        prefillData.description = classified.description;
      }
      if (classified.locationDescription) {
        try {
          const geocodingResults = await geocodingService.forwardGeocode(
            classified.locationDescription,
            { limit: 1 }
          );
          const bestMatch = geocodingResults[0];
          if (bestMatch?.point) {
            const point = toPoint(bestMatch.point);
            if (point) {
              prefillData.location = {
                ...point,
                locationDescription: classified.locationDescription,
              };
            }
          }
        } catch (error) {
          console.error(
            'Intent classification location geocoding error:',
            error
          );
        }
      }

      return startFlow(
        thread,
        incidentFlow,
        context,
        new Set(),
        Object.keys(prefillData).length > 0 ? prefillData : undefined
      );
    }

    return false;
  }

  async function handleFlowStartCommand(
    thread: BotThread,
    input: unknown,
    context: { hasResident: boolean }
  ): Promise<boolean> {
    if (typeof input !== 'string') {
      return false;
    }

    const resolved = flowRegistry.resolveStartCommandInput(input);
    if (!resolved) {
      return false;
    }

    const started = await startFlow(thread, resolved.flow, context);
    if (!started || !resolved.payload) {
      return started;
    }

    const state = (await thread.state) as FlowThreadState | null;
    if (!state) {
      return started;
    }

    const currentStep = flowEngine.getCurrentStep(resolved.flow, state);
    if (currentStep.type !== 'text') {
      return started;
    }

    await processFlowInput(thread, resolved.payload);
    return true;
  }

  async function resolveFlowContext(thread: BotThread): Promise<{
    state: FlowThreadState;
    flow: Flow;
  } | null> {
    const state = (await thread.state) as FlowThreadState | null;
    if (!state) {
      await postWithRetry(thread, translate('error.flow.invalid_step'));
      return null;
    }

    const flow = flowRegistry.get(state.flowId);
    if (!flow) {
      console.error(`Flow not registered: ${state.flowId}`);
      await postWithRetry(thread, translate('handler.error', state.locale));
      return null;
    }

    return { state, flow };
  }

  async function ensureSelectionStepOptions(
    thread: BotThread,
    flow: Flow,
    state: FlowThreadState
  ): Promise<void> {
    if (flowEngine.isFlowComplete(flow, state)) {
      return;
    }

    const currentStep = flowEngine.getCurrentStep(flow, state);
    if (currentStep.type !== 'selection') {
      return;
    }

    if ((currentStep.options?.length ?? 0) > 0) {
      return;
    }

    if (flow.onStart) {
      await flow.onStart(thread);
    }
  }

  async function continueFlowAfterTransition(
    thread: BotThread,
    flow: Flow,
    state: FlowThreadState
  ): Promise<void> {
    let currentState = state;

    if (flowEngine.isFlowComplete(flow, currentState)) {
      try {
        await flow.onComplete(currentState.data, thread);
      } catch (error) {
        console.error('Error in flow.onComplete:', error);
      }
      return;
    }

    while (!flowEngine.isFlowComplete(flow, currentState)) {
      await ensureSelectionStepOptions(thread, flow, currentState);

      const currentStep = flowEngine.getCurrentStep(flow, currentState);

      await flowEngine.renderCurrentStep(thread, flow, currentState);

      if (
        currentStep.type !== 'confirmation' ||
        currentStep.confirmation?.mode === 'interactive'
      ) {
        return;
      }

      const advanced = await flowEngine.advanceStep(currentState, flow);
      currentState = advanced.nextState;
      await thread.setState(currentState);

      if (advanced.isComplete) {
        try {
          await flow.onComplete(currentState.data, thread);
        } catch (error) {
          console.error('Error in flow.onComplete:', error);
        }
        return;
      }
    }
  }

  async function processFlowInput(
    thread: BotThread,
    input: unknown,
    options?: { requireSelectionStep?: boolean }
  ): Promise<void> {
    const context = await resolveFlowContext(thread);
    if (!context) return;

    const { state, flow } = context;

    await ensureSelectionStepOptions(thread, flow, state);

    if (flowEngine.isFlowComplete(flow, state)) {
      await postWithRetry(
        thread,
        translate('handler.flow_already_complete', state.locale)
      );
      return;
    }

    if (options?.requireSelectionStep) {
      const currentStep = flowEngine.getCurrentStep(flow, state);
      if (
        currentStep.type !== 'selection' &&
        currentStep.type !== 'confirmation'
      ) {
        return;
      }
    }

    const result = await flowEngine.handleStepInput(
      flow,
      state,
      thread as BotThread,
      input
    );

    if (result.response) {
      await postWithRetry(thread, result.response);
    }

    await thread.setState(result.nextState);
    await continueFlowAfterTransition(thread, flow, result.nextState);
  }

  /**
   * Handle new mentions: Check if resident exists, start onboarding if not.
   */
  bot.onNewMention(async (thread) => {
    await thread.subscribe();

    try {
      const resident = await getResidentByThreadId(thread);
      const hasResident = Boolean(resident);
      const autoStartFlow = hasResident
        ? undefined
        : flowRegistry.getAutoStartForUnregisteredResident();

      if (autoStartFlow) {
        await startFlow(thread, autoStartFlow, { hasResident });
        return;
      }

      // Resolve locale for the resident
      const locale = await resolveThreadLocale(thread as BotThread);

      const welcomeMsg = hasResident
        ? translate('handler.start.welcome_back', locale)
        : translate('handler.start.welcome', locale);

      await postWithRetry(thread, welcomeMsg);
      await postAvailableCommandHint(thread as BotThread, locale);
    } catch (error) {
      console.error('Error in onNewMention handler:', error);
      await postWithRetry(thread, translate('error.unexpected'));
    }
  });

  /**
   * Handle messages in subscribed threads: Route through active flow.
   */
  bot.onSubscribedMessage(async (thread, message) => {
    try {
      const userText = typeof message.text === 'string' ? message.text : '';

      // Allow user to stop the bot
      if (normalizeText(userText) === 'stop') {
        const locale = await resolveThreadLocale(thread as BotThread);
        await postWithRetry(thread, translate('handler.stop', locale));
        await thread.unsubscribe();
        return;
      }

      const resident = await getResidentByThreadId(thread as BotThread);
      const hasResident = Boolean(resident);

      if (
        await handleReportStatusQuery(
          thread as BotThread,
          userText,
          await resolveThreadLocale(thread as BotThread)
        )
      ) {
        return;
      }

      if (
        await handleFlowStartCommand(thread as BotThread, userText, {
          hasResident,
        })
      ) {
        return;
      }

      const state = (await thread.state) as FlowThreadState | null;
      const activeFlow = state ? flowRegistry.get(state.flowId) : undefined;

      if (state && !activeFlow) {
        await postWithRetry(thread, translate('handler.error', state.locale));
        return;
      }

      const hasActiveFlow = Boolean(
        state && activeFlow && !flowEngine.isFlowComplete(activeFlow, state)
      );

      if (!hasActiveFlow) {
        const locale = state
          ? state.locale
          : await resolveThreadLocale(thread as BotThread);

        if (
          await handleIntentClassification(
            thread as BotThread,
            userText,
            { hasResident },
            locale
          )
        ) {
          return;
        }

        await postAvailableCommandHint(thread as BotThread, locale);
        return;
      }

      await processFlowInput(thread as BotThread, message);
    } catch (error) {
      console.error('Error processing message:', error);
      await postWithRetry(thread, translate('handler.error'));
    }
  });

  /**
   * Handle action events (e.g., button clicks).
   */
  bot.onAction(async (event) => {
    if (!event.thread) {
      console.warn('No thread in action event');
      return;
    }

    try {
      if (
        event.actionId === 'idle_start_flow' &&
        typeof event.value === 'string' &&
        event.value.trim().length > 0
      ) {
        const locale = await resolveThreadLocale(event.thread as BotThread);

        if (
          await handleReportStatusQuery(
            event.thread as BotThread,
            event.value,
            locale
          )
        ) {
          return;
        }

        const resident = await getResidentByThreadId(event.thread as BotThread);
        const hasResident = Boolean(resident);

        const started = await handleFlowStartCommand(
          event.thread as BotThread,
          event.value,
          { hasResident }
        );

        if (started) {
          return;
        }
      }

      await processFlowInput(event.thread as BotThread, event, {
        requireSelectionStep: true,
      });
    } catch (error) {
      console.error('Error handling action event:', error);
      const locale = await resolveThreadLocale(event.thread as BotThread);
      await postWithRetry(event.thread, translate('handler.error', locale));
    }
  });
}
