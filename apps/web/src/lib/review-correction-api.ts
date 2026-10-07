import type { OwnerReviewDetailQuery, OwnerReviewHistoryQuery, OwnerReviewStatus, ReviewFeedbackDetail, ReviewFeedbackSummary, ReviewInputSummary, ReviewOperationDetail, ReviewOperationSummary } from '../../../../packages/protocol/generated/types.ts';
import { validate } from '../../../../packages/protocol/src/validation.ts';
import { APIError } from './api.ts';
import { taskRead } from './task-api.ts';
import { taskStorageEpoch } from './task-storage.ts';

const mismatch = () => { throw new APIError('invalid_response', 'The review response did not match the selected Task and correction.'); };
function unique(values: string[]) { if (new Set(values).size !== values.length) mismatch(); }
function operation(value: ReviewOperationSummary) {
  if (value.purpose === 'route_feedback' && (value.input_id || value.reconsideration_id)) mismatch();
  if (value.purpose === 'reconsider_input' && (!value.input_id || !value.reconsideration_id)) mismatch();
  if (value.status === 'issue' && !value.issue_id) mismatch();
  if (['rework','replan','requirement','withdrawn','cancelled','resolved'].includes(value.status) && value.retry_allowed) mismatch();
}
function feedback(value: ReviewFeedbackSummary) {
  if (value.feedback_id !== value.operation.feedback_id || value.operation.purpose !== 'route_feedback') mismatch();
  operation(value.operation);
}
function input(value: ReviewInputSummary) {
  if (value.operation.purpose !== 'reconsider_input' || value.input_id !== value.operation.input_id || value.reconsideration_id !== value.operation.reconsideration_id) mismatch();
  operation(value.operation);
}
function fence(epoch: number, signal?: AbortSignal) {
  if (signal?.aborted || epoch !== taskStorageEpoch()) throw new APIError('unavailable', 'This review read belongs to a previous Task or session.');
}
export async function reviewStatus(task: string, session: string, signal?: AbortSignal, query: OwnerReviewHistoryQuery = {}): Promise<OwnerReviewStatus> {
  validate('OwnerReviewHistoryQuery', query);
  const epoch = taskStorageEpoch();
  const data = await taskRead<OwnerReviewStatus>(task,'/review','OwnerReviewStatus',{...query},session,signal);
  if (query.feedback_cursor && data.history_next_cursor === query.feedback_cursor || query.input_cursor && data.inputs_next_cursor === query.input_cursor) mismatch();
  if (data.request_changes_allowed && (!data.basis || data.feedback?.status === 'active')) mismatch();
  if (data.feedback) feedback(data.feedback);
  unique(data.history.map(value => value.feedback_id)); unique(data.inputs.map(value => value.reconsideration_id));
  data.history.forEach(feedback); data.inputs.forEach(input);
  fence(epoch, signal); return data;
}
export async function reviewFeedback(task: string, expected: Pick<ReviewFeedbackSummary,'feedback_id'|'review_result_digest'>, session: string, signal?: AbortSignal, query: OwnerReviewDetailQuery = {}): Promise<ReviewFeedbackDetail> {
  validate('Id', expected.feedback_id); validate('SHA256', expected.review_result_digest); validate('OwnerReviewDetailQuery', query);
  const epoch = taskStorageEpoch();
  const data = await taskRead<ReviewFeedbackDetail>(task,`/review/feedback/${encodeURIComponent(expected.feedback_id)}`,'ReviewFeedbackDetail',{...query},session,signal);
  if (data.feedback.feedback_id !== expected.feedback_id || data.feedback.review_result_digest !== expected.review_result_digest || data.basis.review_result_digest !== expected.review_result_digest || query.decision_cursor && data.decisions_next_cursor === query.decision_cursor) mismatch();
  feedback(data.feedback); unique(data.decisions.map(value => value.request_id));
  fence(epoch, signal); return data;
}
export async function reviewOperation(task: string, expected: ReviewOperationSummary, session: string, signal?: AbortSignal): Promise<ReviewOperationDetail> {
  validate('ReviewOperationSummary', expected);
  const epoch = taskStorageEpoch();
  const data = await taskRead<ReviewOperationDetail>(task,`/review/operations/${encodeURIComponent(expected.operation_id)}`,'ReviewOperationDetail',undefined,session,signal), value = data.operation;
  if (value.operation_id !== expected.operation_id || value.feedback_id !== expected.feedback_id || value.purpose !== expected.purpose || value.input_id !== expected.input_id || value.reconsideration_id !== expected.reconsideration_id) mismatch();
  operation(value); unique(data.stop_operation_ids);
  if (data.issue && (data.issue.issue_id !== value.issue_id || data.issue.source_id !== value.source_id)) mismatch();
  if (data.source && (data.source.source_id !== value.source_id || data.source.feedback_id !== value.feedback_id || data.source.operation_id !== value.operation_id || data.source.purpose !== value.purpose || data.source.operation_version > value.operation_version || data.source.input_id !== value.input_id || data.source.reconsideration_id !== value.reconsideration_id)) mismatch();
  fence(epoch, signal); return data;
}
