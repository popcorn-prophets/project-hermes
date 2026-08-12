import type { BotThread } from '@/lib/bot/types';
import { DEFAULT_LOCALE, isSupportedLocale } from '../i18n';
import type { ResidentLocale } from '../i18n/types';
import { stepHandlerRegistry } from '../steps/step-handler-registry';
import type { Step } from '../steps/step-types';
import { COMPLETE_FLOW_STEP_ID } from './confirmation-step';
import { flowRegistry } from './flow-registry';
import type { Flow, FlowData, FlowThreadState } from './flow-types';

/**
 * Core orchestrator for conversational flows.
 *
 * Responsibilities:
 * - Load and manage flow definitions
 * - Track current step and progress through a flow
 * - Handle input parsing and step transitions
 * - Validate transitions and enforce flow guards
 * - Call step-specific handlers for input parsing and UI rendering
 */
class FlowEngine {
  private resolveStepForRender(step: Step, state: FlowThreadState): Step {
    const resolvedPrompt =
      step.renderPrompt?.(state.data, state.locale) ?? step.prompt;
    const resolvedContent =
      step.renderContent?.(state.data, state.locale) ?? step.content;
    const resolvedOptions =
      step.renderOptions?.(state.data, state.locale) ?? step.options;

    return {
      ...step,
      prompt: resolvedPrompt,
      content: resolvedContent,
      options: resolvedOptions,
    };
  }

  private pruneDataFromStep(
    flow: Flow,
    data: FlowData,
    stepIndex: number
  ): FlowData {
    const nextData = { ...data };

    for (const step of flow.steps.slice(stepIndex)) {
      const dataKey = step.dataKey || step.id;
      delete nextData[dataKey];
    }

    return nextData;
  }

  private resolveStepIndex(flow: Flow, stepId: string): number {
    return flow.steps.findIndex((step) => step.id === stepId);
  }

  private isInteractiveEditDecision(
    step: Step,
    value: unknown
  ): value is string {
    return (
      step.type === 'confirmation' &&
      step.confirmation?.mode === 'interactive' &&
      typeof value === 'string' &&
      value === 'edit'
    );
  }

  /**
   * Load a flow from the registry.
   */
  private getFlow(flowId: string): Flow {
    const flow = flowRegistry.get(flowId);
    if (!flow) {
      throw new Error(`Flow not registered: ${flowId}`);
    }
    return flow;
  }

  /**
   * Get the current step from thread state.
   */
  getCurrentStep(flow: Flow, state: FlowThreadState): Step {
    if (state.stepIndex < 0 || state.stepIndex >= flow.steps.length) {
      throw new Error(
        `Invalid step index ${state.stepIndex} for flow ${flow.id} with ${flow.steps.length} steps`
      );
    }
    return flow.steps[state.stepIndex];
  }

  /**
   * Determine if a flow is complete.
   */
  isFlowComplete(flow: Flow, state: FlowThreadState): boolean {
    return state.stepIndex >= flow.steps.length;
  }

  /**
   * Rewind flow state to a prior step and clear stale answers from that step onward.
   */
  rewindToStep(
    flow: Flow,
    state: FlowThreadState,
    targetStepId: string,
    data: FlowData = state.data
  ): FlowThreadState {
    const targetStepIndex = this.resolveStepIndex(flow, targetStepId);

    if (targetStepIndex === -1) {
      throw new Error(`Step not found in flow ${flow.id}: ${targetStepId}`);
    }

    return {
      flowId: state.flowId,
      flowVersion: state.flowVersion,
      stepIndex: targetStepIndex,
      data: this.pruneDataFromStep(flow, data, targetStepIndex),
      pendingReturnStepId: state.pendingReturnStepId,
      locale: state.locale,
      startedAt: state.startedAt,
    };
  }

  /**
   * Render the current step's UI.
   */
  async renderCurrentStep(
    thread: BotThread,
    flow: Flow,
    state: FlowThreadState
  ): Promise<void> {
    if (this.isFlowComplete(flow, state)) {
      // Flow complete, but this shouldn't be called
      console.warn(`Attempted to render step for completed flow: ${flow.id}`);
      return;
    }

    const step = this.getCurrentStep(flow, state);
    const renderedStep = this.resolveStepForRender(step, state);
    const handler = stepHandlerRegistry.get(renderedStep.type);

    await handler.render(thread, renderedStep);
  }

  /**
   * Handle user input for the current step.
   *
   * Returns:
   * - Updated thread state
   * - Response message to post
   * - Whether flow is complete
   */
  async handleStepInput(
    flow: Flow,
    state: FlowThreadState,
    thread: BotThread,
    input: unknown
  ): Promise<{
    nextState: FlowThreadState;
    response: string;
    isComplete: boolean;
  }> {
    // Get current step and handler
    const currentStep = this.getCurrentStep(flow, state);
    const handler = stepHandlerRegistry.get(currentStep.type);

    // Parse input
    const parseResult = await handler.parse(input, currentStep, thread);

    if ('error' in parseResult) {
      // Validation failed - stay on same step
      return {
        nextState: state,
        response: parseResult.error,
        isComplete: false,
      };
    }

    // Parse succeeded - store value and determine next step
    const dataKey = currentStep.dataKey || currentStep.id;
    let nextLocale = state.locale;

    // Keep locale in thread state in-sync with language preference selection.
    if (dataKey === 'language' && isSupportedLocale(parseResult.value)) {
      nextLocale = parseResult.value;
    }

    let updatedData = {
      ...state.data,
      [dataKey]: parseResult.value,
    };
    let pendingReturnStepId = state.pendingReturnStepId;
    const isInteractiveEdit = this.isInteractiveEditDecision(
      currentStep,
      parseResult.value
    );

    if (isInteractiveEdit) {
      pendingReturnStepId = currentStep.id;
    }

    if (currentStep.onAfterParse) {
      const patch = await currentStep.onAfterParse(
        parseResult.value,
        updatedData,
        input,
        thread
      );
      if (patch) {
        updatedData = {
          ...updatedData,
          ...patch,
        };
      }
    }

    // Determine next step
    let nextStepIndex = state.stepIndex + 1;

    if (currentStep.nextStep) {
      // Custom transition logic
      const nextStepId = currentStep.nextStep(updatedData);
      if (nextStepId) {
        if (nextStepId === COMPLETE_FLOW_STEP_ID) {
          nextStepIndex = flow.steps.length;
        } else {
          const nextStep = flow.steps.find((s) => s.id === nextStepId);
          if (nextStep) {
            nextStepIndex = flow.steps.indexOf(nextStep);
            if (
              nextStepIndex < state.stepIndex &&
              !isInteractiveEdit &&
              !pendingReturnStepId
            ) {
              updatedData = this.pruneDataFromStep(
                flow,
                updatedData,
                nextStepIndex
              );
            }
          }
        }
      }
    }

    if (
      pendingReturnStepId &&
      !isInteractiveEdit &&
      nextStepIndex > state.stepIndex
    ) {
      const returnStepIndex = this.resolveStepIndex(flow, pendingReturnStepId);
      if (returnStepIndex !== -1 && currentStep.id !== pendingReturnStepId) {
        nextStepIndex = returnStepIndex;
        pendingReturnStepId = undefined;
      }
    }

    // Check if flow is complete
    const isComplete = nextStepIndex >= flow.steps.length;

    const nextState: FlowThreadState = {
      flowId: state.flowId,
      flowVersion: state.flowVersion,
      stepIndex: nextStepIndex,
      data: updatedData,
      pendingReturnStepId,
      locale: nextLocale,
      startedAt: state.startedAt,
      completedAt: isComplete ? Date.now() : undefined,
    };

    return {
      nextState,
      response: ``,
      isComplete,
    };
  }

  /**
   * Advance to the next step without consuming input.
   * Used for steps that don't require input (e.g., confirmations).
   */
  async advanceStep(
    state: FlowThreadState,
    _flow: Flow
  ): Promise<{
    nextState: FlowThreadState;
    isComplete: boolean;
  }> {
    const nextStepIndex = state.stepIndex + 1;
    const isComplete = nextStepIndex >= _flow.steps.length;

    return {
      nextState: {
        flowId: state.flowId,
        flowVersion: state.flowVersion,
        stepIndex: nextStepIndex,
        data: state.data,
        pendingReturnStepId: state.pendingReturnStepId,
        locale: state.locale,
        startedAt: state.startedAt,
        completedAt: isComplete ? Date.now() : undefined,
      },
      isComplete,
    };
  }

  /**
   * Create initial flow state.
   * Optionally accepts a locale; defaults to configured locale if not provided.
   */
  createInitialState(
    flowId: string,
    flowVersion: number = 1,
    locale: ResidentLocale = DEFAULT_LOCALE
  ): FlowThreadState {
    const flow = this.getFlow(flowId);

    // Find starting step index
    const startStepIndex = flow.steps.findIndex((s) => s.id === flow.startStep);

    if (startStepIndex === -1) {
      throw new Error(
        `Start step "${flow.startStep}" not found in flow ${flowId}`
      );
    }

    return {
      flowId,
      flowVersion,
      stepIndex: startStepIndex,
      data: {},
      pendingReturnStepId: undefined,
      locale,
    };
  }

  /**
   * Create initial flow state pre-filled with already-known data
   */
  createPrefilledState(
    flowId: string,
    flowVersion: number,
    locale: ResidentLocale,
    data: FlowData
  ): FlowThreadState {
    const flow = this.getFlow(flowId);
    const initialState = this.createInitialState(flowId, flowVersion, locale);

    let stepIndex = initialState.stepIndex;
    while (stepIndex < flow.steps.length) {
      const step = flow.steps[stepIndex];
      const dataKey = step.dataKey || step.id;
      if (data[dataKey] === undefined) {
        break;
      }
      stepIndex += 1;
    }

    return {
      ...initialState,
      stepIndex,
      data,
    };
  }
}

export const flowEngine = new FlowEngine();
