/** @jsxImportSource chat */
import type { BotThread } from '@/lib/bot/types';
import { Actions, Button, Card, CardText } from 'chat';
import type { SelectionOption } from '../steps/step-types';

/**
 * Options for rendering a simple card.
 */
export interface CardOptions {
  title: string;
  content: string;
}

/**
 * Options for rendering a selection card with buttons.
 */
export interface SelectionCardOptions {
  title: string;
  content?: string;
  options: SelectionOption[];
}

export interface IdleCommandOption {
  command: string;
  description: string;
}

export interface IdleCommandCardOptions {
  title: string;
  content?: string;
  options: IdleCommandOption[];
}

/**
 * Render a simple card with text content.
 */
export async function renderCard(
  thread: BotThread,
  options: CardOptions
): Promise<void> {
  await thread.post(
    <Card title={options.title}>
      <CardText>{options.content}</CardText>
    </Card>
  );
}

/**
 * Render a selection card with button options.
 */
export async function renderSelectionCard(
  thread: BotThread,
  options: SelectionCardOptions
): Promise<void> {
  await thread.post(
    <Card>
      <CardText>{options.title}</CardText>
      {options.content ? <CardText>{options.content}</CardText> : null}
      <Actions>
        {options.options.map((option) => (
          <Button
            key={option.value}
            id={`selection_${option.value}`}
            value={option.value}
          >
            {option.label}
          </Button>
        ))}
      </Actions>
    </Card>
  );
}

/**
 * Render idle command options as clickable actions.
 */
export async function renderIdleCommandCard(
  thread: BotThread,
  options: IdleCommandCardOptions
): Promise<void> {
  const descriptions = options.options
    .map((option) => `${option.command}: ${option.description}`)
    .join('\n');

  await thread.post(
    <Card>
      <CardText>{options.title}</CardText>
      {options.content ? <CardText>{options.content}</CardText> : null}
      <Actions>
        {options.options.map((option) => (
          <Button
            key={option.command}
            id="idle_start_flow"
            value={option.command}
          >
            {option.command}
          </Button>
        ))}
      </Actions>
      <CardText>{descriptions}</CardText>
    </Card>
  );
}
