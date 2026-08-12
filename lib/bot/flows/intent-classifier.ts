import { Constants, type Enums } from '@/types/supabase';
import { google } from '@ai-sdk/google';
import { generateText, Output } from 'ai';
import { z } from 'zod';

type IncidentSeverity = Enums<'incident_severity'>;
const INCIDENT_SEVERITIES = Constants.public.Enums
  .incident_severity as readonly IncidentSeverity[];

const CLASSIFIER_TIMEOUT_MS = 5000;

export type ChatIntent = 'incident_report' | 'settings' | 'status' | 'unclear';

export interface ClassifiedMessage {
  intent: ChatIntent;
  incidentTypeName?: string;
  severity?: IncidentSeverity;
  description?: string;
  locationDescription?: string;
}

const UNCLEAR_RESULT: ClassifiedMessage = { intent: 'unclear' };

function buildClassifierSchema(allowedIncidentTypeNames: string[]) {
  return z.object({
    intent: z
      .enum(['incident_report', 'settings', 'status', 'unclear'])
      .describe(
        'What the resident is trying to do: report an incident, change settings, check report status, or unclear/none of these.'
      ),
    incidentTypeName: z
      .enum(allowedIncidentTypeNames as [string, ...string[]])
      .optional()
      .describe(
        'Incident type, only if intent is incident_report and it can be confidently determined from the message.'
      ),
    severity: z
      .enum(INCIDENT_SEVERITIES)
      .optional()
      .describe(
        'Severity level, only if intent is incident_report and it can be confidently determined from the message.'
      ),
    description: z
      .string()
      .optional()
      .describe(
        'Concise description of what happened, only if intent is incident_report.'
      ),
    locationDescription: z
      .string()
      .optional()
      .describe(
        'Human-readable location (landmarks, street, barangay, city), only if intent is incident_report and mentioned. Never coordinates.'
      ),
  });
}

/**
 * Classifies a free-text chat message into an intent, best-effort extracting
 * incident fields when the intent looks like a report.
 *
 * This is a convenience layer only: on any failure (timeout, API error,
 * missing config), callers must treat the result identically to `unclear`
 * and fall back to the existing deterministic command flow.
 */
export async function classifyChatIntent({
  text,
  allowedIncidentTypeNames,
}: {
  text: string;
  allowedIncidentTypeNames: string[];
}): Promise<ClassifiedMessage> {
  if (!text.trim() || allowedIncidentTypeNames.length === 0) {
    return UNCLEAR_RESULT;
  }

  try {
    const result = await generateText({
      model: google('gemini-2.5-flash-lite'),
      output: Output.object({
        schema: buildClassifierSchema(allowedIncidentTypeNames),
      }),
      temperature: 0,
      timeout: CLASSIFIER_TIMEOUT_MS,
      system: [
        'Classify the resident message into one intent: incident_report, settings, status, or unclear.',
        'incident_report: describes something happening (fire, flood, accident, medical emergency, etc.) that should be reported.',
        'settings: wants to change profile/notification/language preferences.',
        'status: asking about the status/progress of a previously submitted report.',
        'unclear: greetings, small talk, or anything that does not clearly match the above.',
        'If incident_report, extract only fields you are confident about; omit fields you cannot determine. Never guess coordinates.',
      ].join('\n'),
      messages: [
        {
          role: 'user',
          content: text,
        },
      ],
    });

    return {
      intent: result.output.intent,
      incidentTypeName: result.output.incidentTypeName,
      severity: result.output.severity,
      description: result.output.description?.trim() || undefined,
      locationDescription:
        result.output.locationDescription?.trim() || undefined,
    };
  } catch (error) {
    console.error('Chat intent classification failed:', error);
    return UNCLEAR_RESULT;
  }
}
