import type { Code, CommandEnvelope, ErrorInfo } from '../../protocol/generated/types.ts';

export class CommandError extends Error {
  readonly detail: ErrorInfo;
  constructor(code: Code, message: string, current_control_version?: number) {
    super(message);
    this.detail = { code, message, ...(current_control_version === undefined ? {} : { current_control_version }) };
  }
}

export interface AdmissionBasis {
  kind: 'node' | 'planner';
  taskId?: string; scopeId?: string; scopeKind?: 'task' | 'todo';
  resourceId?: string;
  projectResources?: boolean;
  initialPlanning?: boolean;
  mutationAllowed: boolean;
  processReleased: boolean;
  controlVersion: number;
  sourceWatermark: number;
  connectionAvailable: boolean;
}

// Receipt lookup happens in the owning transaction before these new-effect guards.
export function guardNewCommand(command: CommandEnvelope, basis: AdmissionBasis): void {
  if (command.scope_id !== (basis.scopeId ?? basis.taskId)) throw new CommandError('denied_scope', 'Command belongs to another scope');
  if (!basis.mutationAllowed || basis.processReleased) throw new CommandError('stale_execution', 'Attempt mutation authority has ended');
  if (!basis.connectionAvailable) throw new CommandError('control_unavailable', 'Runner control connection is unavailable');
  if (command.expected_control_version !== basis.controlVersion) throw new CommandError('version_conflict', 'Expected control version is stale', basis.controlVersion);
  if (basis.scopeKind === 'todo') {
    if (basis.kind !== 'planner' || !['inspect_repository', 'commit_discussion_turn', 'read_discussion', 'update_working_requirement_state'].includes(command.name)) throw new CommandError('denied_scope', 'Command is outside Todo Planner authority');
    if (command.name === 'commit_discussion_turn' && command.payload.source_watermark !== basis.sourceWatermark) throw new CommandError('version_conflict', 'Discussion source watermark differs');
    return;
  }
  if (['commit_discussion_turn', 'read_discussion', 'update_working_requirement_state'].includes(command.name)) throw new CommandError('denied_scope', 'Todo command requires a Todo Planner');
  const initialOutcome = command.name === 'publish_execution_plan' || command.name === 'raise_planning_issue';
  if (initialOutcome && !basis.initialPlanning) throw new CommandError('denied_scope', 'Initial outcome requires a source-bound Task Planner');
  if (basis.initialPlanning && command.name !== 'inspect_repository' && !initialOutcome) throw new CommandError('denied_scope', 'Initial Planner must publish a Plan or raise an issue');
  const plannerCommand = command.name === 'inspect_repository' || command.name === 'commit_task_turn' || initialOutcome;
  if (plannerCommand !== (basis.kind === 'planner')) throw new CommandError('denied_scope', 'Command is not allowed for this execution scope');
  if (!basis.projectResources && command.payload.resource_id !== undefined && command.payload.resource_id !== basis.resourceId) throw new CommandError('denied_scope', 'Resource is outside the Project fixture');
  if (command.name === 'commit_task_turn' && command.payload.source_watermark !== basis.sourceWatermark) throw new CommandError('version_conflict', 'Planner source watermark is stale');
}
