package adapter

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/host"
	"monos.local/runner/internal/wire"
)

// Policy order is significant to OpenCode; this struct keeps '*' first.
type permissions struct {
	All       string          `json:"*"`
	Read      string          `json:"read"`
	Glob      string          `json:"glob"`
	Grep      string          `json:"grep"`
	Bash      string          `json:"bash"`
	Edit      string          `json:"edit"`
	External  json.RawMessage `json:"external_directory"`
	Question  string          `json:"question"`
	Task      string          `json:"task"`
	Skill     string          `json:"skill"`
	LSP       string          `json:"lsp"`
	Webfetch  string          `json:"webfetch"`
	Websearch string          `json:"websearch"`
	PlanEnter string          `json:"plan_enter"`
	PlanExit  string          `json:"plan_exit"`
}

func fixedProtocol(d protocol.Dispatch) string {
	text := "Use native bash to invoke /usr/local/bin/monos for formal monos actions. Run monos --help to discover commands. Natural-language output is never a formal state transition. Do not start background services or subagents."
	if d.TaskReviewSource != nil {
		s := d.TaskReviewSource
		text += fmt.Sprintf(" You are the dedicated Task Review Planner for feedback_id %q, operation_id %q, operation_version %d and source_id %q, purpose %q. Use only the frozen reviewed result, Specification, Plan, original Owner feedback and retained input/proposal lineage. Read bounded formal context with monos read_task_context/read_task_history; Repository inspection is unavailable in Stage A; use the retained formal result evidence. Never open a writable workspace, complete a Node, append a second input reply or silently change requirements. For route_feedback finish with source-bound monos apply_review_rework (exact existing Node IDs within current requirements), commit_review_feedback (exact genuine prepared requirements proposal), request_replan (concrete graph insufficiency) or raise_planning_issue. For reconsider_input finish with monos resolve_review_input using the exact reconsideration_id and a fresh semantic routing decision, or raise_planning_issue. For input graph insufficiency use resolve_review_input routing kind replan with current basis and text reason; never call generic request_replan or resolve the main feedback. The source-bound review commands carry the exact supplied identity/version; request_replan carries its concrete reason and is bound by this launch. Current basis is separate from operation capability. prepare_specification_revision is nonterminal and creates an immutable draft only. Main feedback may adopt an earlier same-feedback reconsideration proposal only through its exact retained lineage and unchanged semantic basis; publication still requires the actual Owner confirmation. Do not call apply_specification_revision or infer approval from prose. A dismissed Replan, control bump or Retry alone is not new Owner direction to repeat that request. One committed outcome ends this phase; launch, reads, printed prose and process exit are not outcomes. Write JSON in scratch and use monos COMMAND --input FILE --output json. For uncertainty use command-status --request-id ID then retry --request-id ID with the original immutable request; never replace uncertain bytes or wait alive for publication.", s.FeedbackID, s.OperationID, s.OperationVersion, s.SourceID, s.Purpose)
	}
	if d.TaskConversationSource != nil {
		s := d.TaskConversationSource
		text += fmt.Sprintf(" You are the Task Conversation Planner for source_id %q, input_id %q and source_watermark %d. Use only this Task's frozen input and formal context. Read bounded current formal facts with monos read_task_context and older cutoff-bound conversation with monos read_task_history. Never read Todo Discussion, another Task, raw logs or repository files, and never create another Task or publish a Plan. Before ending, call monos commit_task_turn with those exact source_id/input_id/source_watermark, your reply and routing. A read, process launch/exit or printed reply is not a committed turn. The envelope's expected_control_version is the fixed conversation source version, not execution control. For action routing, read current context, re-evaluate the action and use its separate basis; do not just substitute a newer version into an old assessment. For a complete requirement change, use monos prepare_specification_revision with proposal_id, complete specification Markdown, summary, current basis, full impact and explicit source_input_ids (optional supersedes links a replacement). Only an unchanged sufficient graph is supported; never silently edit Node definitions. Preparation creates an immutable draft, not publication or a terminal outcome. Attach it through commit_task_turn routing specification_proposal with proposal_id and basis so the Owner can review the exact content and impact. Unattached drafts cannot be confirmed. monos apply_specification_revision requires proposal_id, confirmation_id for an existing exact Owner receipt, and current basis; never infer authorization from prose or manufacture a receipt. Owner apply can proceed independently of this Planner. Apply returns an operation reference for settlement, not proof of publication or implementation; still close this turn with commit_task_turn. Do not remain alive waiting for settlement. Changed content, graph or impact needs a fresh proposal and authorization. Routing kinds include replan (actual Plan insufficiency: commit the reply atomically with routing kind replan, current basis and text reason; never call request_replan or prepare_replan from Conversation), reply, specification_proposal (attach the exact prepared draft), guidance (within existing scope), issue (pending work, never a claim of an effective revision), answer (exact existing issue, not Retry/Continue), and resolve_guidance (exact obligation/version with no-work explanation). Guidance uses controlled Stop/fresh Attempt and cannot override Owner Stop, independent blockers, accepted delivery or terminal Task state. Do not infer handling from launch. Write payload JSON in scratch and run monos COMMAND --input FILE --output json. For uncertain responses use monos command-status --request-id ID then monos retry --request-id ID with the original immutable request; never replace an uncertain request. A committed reply/routing ends your phase even if a resulting obligation remains pending.", s.SourceID, s.InputID, s.SourceWatermark)
		if s.ReplyOnly {
			text += " This source is conversation-only: use routing {\"kind\":\"reply\"}; no prepare_specification_revision, apply_specification_revision, guidance, issue, answer, resolution or execution effect is authorized."
		}
	}
	if d.NodeExecutionSource != nil {
		text += " You execute the supplied canonical Plan Node using its frozen Specification, goal, requirements and Role instructions. Publish optional bounded UTF-8 outputs with monos publish_artifact; HTML is managed output data. Read scoped output content with monos read_artifact. For actual Plan insufficiency call monos request_replan with a concrete reason. This is a terminal handoff that stops this Attempt; do not issue a second outcome or prepare a replacement graph. Before ending use monos complete_node with summary and optional artifact_ids, or monos block_node with a concrete reason requiring Owner direction. Omitted artifact_ids selects this Attempt's outputs; [] selects none. Declare the exact launch-assigned guidance you handled in handled_guidance_ids; omission or [] declares none, never all. Include every still-required launch instruction or block_node with the unresolved reason. A rejected completion can be corrected with a new request, but an uncertain admitted completion retains its original request and manifest. Receiving guidance is not proof of handling. Publication, prose and process exit do not complete work. Repository-free work may complete without Git; opened or retained dirty repository work must be finalized. Do not modify requirements or Plan, read Todo/other Task context, or use Planner outcome commands. For uncertain responses query monos command-status then monos retry with the original request ID. Write JSON in scratch files and call monos COMMAND --input FILE --output json."
	}
	if d.TaskReplanSource != nil {
		s := d.TaskReplanSource
		text += fmt.Sprintf(" You are the dedicated Task Replan Planner for replan_request_id %q and source_id %q, effective Plan %q and Specification %q. Use only the frozen quiescent Task context, exact current graph/evidence, independent holds, guidance and private-work facts. Before ending call exactly one of monos prepare_replan or monos raise_planning_issue with those exact replan_request_id and source_id. prepare_replan supplies proposal_id, plan_id, basis, nodes, summary and full impact; optional requirement supplies a complete linked requirements proposal for separate Owner confirmation. Support one complete Node with dependencies: []; nonempty consumes and multi-Node Plans are unsupported. Every changed formal Node definition requires a new node_id; retained IDs require exact equality including omitted versus empty optional arrays and explicit evidence applicability. Cross-Node unfinished private work requires exact predecessor checkpoint and target disposition; never clear, reset or relabel old work. Preparation is terminal and does not publish: the Owner confirms exact graph and requirements separately and publishes atomically after physical release. Do not remain alive waiting for confirmation. A scoped planning issue also ends this phase. Never use initial planning_intent_id, publish_execution_plan, request_replan, commit_task_turn, complete_node or standalone Specification commands. A rejected command is not an outcome: correct it with a new request or raise an issue. For uncertain responses use monos command-status --request-id ID and monos retry --request-id ID with the same retained request ID. Write JSON in scratch and use monos COMMAND --input FILE --output json. Do not execute the Node or read Todo/other Task context.", s.RequestID, s.SourceID, s.PlanID, s.SpecificationID)
	}
	if d.TaskPlanningSource != nil {
		text += fmt.Sprintf(" You are the initial Execution Task Planner for planning_intent_id %q and Specification %q. Use this Attempt's frozen Task context: the effective Specification, Project/resource summary, selected Role descriptors and applicable Owner issue answers. Do not resume or read Todo Discussion, requirement caches, other Task context or prior Runtime sessions. Before ending, call exactly one of monos publish_execution_plan or monos raise_planning_issue with that exact planning_intent_id. Publish one Node with node_id, a supplied role_id, a concrete goal and dependencies: []; preserve its hard_requirements and expected_outputs. Nonempty consumes and multi-Node Plans are unsupported; do not drop requirements or flatten a larger graph. If the Specification is insufficient, contradictory, or cannot be planned within this slice, raise a clear planning issue for Owner direction. A validation rejection is not an outcome: correct it with a new request or raise the issue. Never use commit_task_turn, commit_discussion_turn, or complete_node to finish this phase. Write command payloads through bash in this Attempt's scratch directory or pass JSON on stdin. If a response is uncertain, use monos command-status and monos retry with the same retained request ID; never replace an uncertain request. A committed plan or issue ends this phase; do not execute the Node yourself.", d.TaskPlanningSource.IntentID, d.TaskPlanningSource.SpecificationID)
	}
	if d.TodoID != nil {
		text += " You are the Todo Discussion Planner. Use only this Todo's supplied context and source message. No Execution Task or writable repository exists for this Attempt. Repository inspection is unavailable; never read the probe fixture or another Attempt's files. Older in-scope history is available through monos read_discussion. An explicit cache rebuild uses monos update_working_requirement_state with the supplied resolved watermark and Project context version/digest; rebuilding does not resolve the pending message. Before ending, call monos commit_discussion_turn with the exact source_message_id and source_watermark from your context, your final reply and working_requirement_state. Optional task_preview only proposes title/specification for later Owner confirmation; never create a Task. If a command response is uncertain, query monos command-status and retry the same retained request ID. Do not replace uncertain requests or treat printed prose as a committed reply."
	}
	if d.WorkspaceReservations != nil {
		if d.Kind == protocol.Node {
			text += " Before accessing a Project repository, call monos open_workspace with its resource_id. Work only at the returned result.path and read every relative root filename in result.instruction_files before coding. Reserved paths do not grant repository access. Do not clone, fetch, push or publish system repositories yourself; monos owns these operations."
		} else if d.TaskReviewSource != nil {
			text += " Empty reservations never grant Task repository access; repository inspection is unavailable in Stage A."
		} else {
			text += " Repository inspection is unavailable in this slice. Never read a writable Task workspace or the probe fixture."
		}
	}
	return text
}

func Config(d protocol.Dispatch) (string, error) {
	if d.TaskReviewSource != nil || d.TaskReplanSource != nil || d.TaskPlanningSource != nil || d.NodeExecutionSource != nil || d.TaskConversationSource != nil {
		if _, err := wire.ScopeID(d); err != nil {
			return "", err
		}
	}
	edit := "deny"
	if d.Kind == protocol.Node {
		edit = "allow"
	}
	external := `"allow"`
	// Only interactive questions, unreviewed skill/subagent delegation and role
	// switching are excluded from this single-runtime, explicitly free probe.
	perms := permissions{"allow", "allow", "allow", "allow", "allow", edit, json.RawMessage(external), "deny", "deny", "deny", "allow", "allow", "allow", "deny", "deny"}
	fixed := map[string]any{"model": host.FreeModel}
	cfg := map[string]any{"model": host.FreeModel, "small_model": host.FreeModel, "share": "disabled", "snapshot": false, "autoupdate": false, "shell": "/bin/bash", "agent": map[string]any{
		"monos-probe": map[string]any{"mode": "primary", "model": host.FreeModel, "permission": perms, "prompt": fixedProtocol(d)}, "title": fixed, "summary": fixed, "compaction": fixed}}
	raw, err := json.Marshal(cfg)
	return string(raw), err
}
func Environment(d protocol.Dispatch) ([]string, error) {
	config, err := Config(d)
	if err != nil {
		return nil, err
	}
	base := host.AttemptRoot(d.AttemptID)
	return []string{"HOME=/home/me", "PWD=" + host.Path(d.AttemptID, "scratch"), "USER=me", "LOGNAME=me", "PATH=/usr/local/bin:/home/linuxbrew/.linuxbrew/bin:/usr/bin:/bin", "LANG=C.UTF-8", "SHELL=/bin/bash", "TMPDIR=" + filepath.Join(base, "tmp"), "XDG_DATA_HOME=" + filepath.Join(base, "data"), "XDG_CACHE_HOME=" + filepath.Join(base, "cache"), "XDG_CONFIG_HOME=" + filepath.Join(base, "config"), "XDG_STATE_HOME=" + filepath.Join(base, "state"), "MONOS_SOCKET=" + host.Socket, "OPENCODE_CONFIG_CONTENT=" + config, "OPENCODE_DISABLE_PROJECT_CONFIG=1", "OPENCODE_DISABLE_AUTOUPDATE=1", "OPENCODE_DISABLE_LSP_DOWNLOAD=1", "OPENCODE_DISABLE_EXTERNAL_SKILLS=1", "OPENCODE_DISABLE_CLAUDE_CODE=1"}, nil
}

// BoundedWriter preserves partial output but bounds retained logs per Attempt.
type BoundedWriter struct {
	W         io.Writer
	Remaining int64
	Truncated bool
}

const TruncationMarker = "\n[monos log truncated: retention limit reached]\n"

func (w *BoundedWriter) truncate() error {
	if w.Truncated {
		return nil
	}
	w.Truncated = true
	n, err := io.WriteString(w.W, TruncationMarker)
	if err == nil && n != len(TruncationMarker) {
		err = io.ErrShortWrite
	}
	return err
}

func (w *BoundedWriter) Write(p []byte) (int, error) {
	n := len(p)
	if n == 0 {
		return 0, nil
	}
	if w.Remaining <= 0 {
		return n, w.truncate()
	}
	slice := p
	if int64(len(slice)) > w.Remaining {
		slice = slice[:w.Remaining]
	}
	written, err := w.W.Write(slice)
	w.Remaining -= int64(written)
	if err != nil {
		return written, err
	}
	if written != len(slice) {
		return written, io.ErrShortWrite
	}
	if written < n {
		if err := w.truncate(); err != nil {
			return written, err
		}
	}
	return n, nil
}

// DurableWriter keeps the Runtime's output in the supervised spool. The
// io.Writer wrapper prevents os/exec from handing the append fd to OpenCode,
// so a short write, ENOSPC or fsync error cancels the child immediately.
type DurableWriter struct {
	W    io.Writer
	Sync func() error
	Mark func()
	Stop context.CancelFunc
}

var ErrCaptureFailure = errors.New("execution output capture failed")

type outputSink struct {
	stdout, stderr   io.Writer
	syncOut, syncErr func() error
	mark             func(string)
}

func (w DurableWriter) Write(p []byte) (int, error) {
	n, err := w.W.Write(p)
	if err == nil && n != len(p) {
		err = io.ErrShortWrite
	}
	if err == nil && w.Sync != nil {
		err = w.Sync()
	}
	if err != nil {
		if w.Mark != nil {
			w.Mark()
		}
		if w.Stop != nil {
			w.Stop()
		}
	}
	return n, err
}

func markCaptureFailure(attemptID string) {
	marker := host.Path(attemptID, "scratch") + "/capture.failure"
	f, err := os.OpenFile(marker, os.O_WRONLY, 0)
	if err != nil {
		return
	}
	_, _ = f.WriteAt([]byte{'1'}, 0)
	_ = f.Sync()
	_ = f.Close()
}

func Run(d protocol.Dispatch) error {
	return run(d, func(cmd *exec.Cmd) error { return cmd.Run() })
}

func run(d protocol.Dispatch, execute func(*exec.Cmd) error) error {
	return runWithSink(d, execute, outputSink{stdout: os.Stdout, stderr: os.Stderr, syncOut: os.Stdout.Sync, syncErr: os.Stderr.Sync, mark: markCaptureFailure})
}

func runWithSink(d protocol.Dispatch, execute func(*exec.Cmd) error, sink outputSink) error {
	if d.RuntimeID != protocol.Opencode || string(d.Model) != host.FreeModel {
		return fmt.Errorf("unapproved runtime/model")
	}
	env, err := Environment(d)
	if err != nil {
		return err
	}
	if err = verifyModel(d, env, execute); err != nil {
		return err
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	cmd := exec.CommandContext(ctx, host.Runtime, Arguments(d)...)
	cmd.Env = env
	cmd.Dir = host.Path(d.AttemptID, "scratch")
	cmd.Stdin = strings.NewReader(d.Prompt)
	var failed atomic.Bool
	mark := func() {
		failed.Store(true)
		if sink.mark != nil {
			sink.mark(d.AttemptID)
		}
	}
	cmd.Stdout = DurableWriter{W: sink.stdout, Sync: sink.syncOut, Mark: mark, Stop: cancel}
	cmd.Stderr = DurableWriter{W: sink.stderr, Sync: sink.syncErr, Mark: mark, Stop: cancel}
	err = execute(cmd)
	if failed.Load() {
		return fmt.Errorf("%w: %v", ErrCaptureFailure, err)
	}
	return err
}

func Arguments(d protocol.Dispatch) []string {
	return []string{"run", "--pure", "--auto", "--format", "json", "--model", host.FreeModel, "--agent", "monos-probe", "--dir", host.Path(d.AttemptID, "scratch")}
}
