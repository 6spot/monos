package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net"
	"os"
	"strings"
	"time"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/control"
	"monos.local/runner/internal/host"
	"monos.local/runner/internal/local"
	"monos.local/runner/internal/wire"
)

const help = `monos — formal monos Tool Protocol commands

  monos open_workspace --input payload.json [--request-id ID] --output json
  monos inspect_repository --input payload.json [--request-id ID] --output json
  monos publish_artifact --input payload.json [--request-id ID] --output json
  monos read_artifact --input payload.json [--request-id ID] --output json
  monos request_replan --input payload.json [--request-id ID] --output json
  monos apply_review_rework --input payload.json [--request-id ID] --output json
  monos commit_review_feedback --input payload.json [--request-id ID] --output json
  monos resolve_review_input --input payload.json [--request-id ID] --output json
  monos prepare_replan --input payload.json [--request-id ID] --output json
  monos block_node --input payload.json [--request-id ID] --output json
  monos complete_node --input payload.json [--request-id ID] --output json
  monos publish_execution_plan --input payload.json [--request-id ID] --output json
  monos raise_planning_issue --input payload.json [--request-id ID] --output json
  monos read_task_context --input payload.json [--request-id ID] --output json
  monos read_task_history --input payload.json [--request-id ID] --output json
  monos prepare_specification_revision --input payload.json [--request-id ID] --output json
  monos apply_specification_revision --input payload.json [--request-id ID] --output json
  monos commit_task_turn --input payload.json [--request-id ID] --output json
  monos read_discussion --input payload.json [--request-id ID] --output json
  monos update_working_requirement_state --input payload.json [--request-id ID] --output json
  monos commit_discussion_turn --input payload.json [--request-id ID] --output json
  monos retry --request-id ID --output json
  monos command-status --request-id ID --output json

Use --input - to read a JSON payload from stdin (maximum 1 MiB).
Workspace payload: {"resource_id":"RESOURCE"}
Node Artifact: {"artifact_id":"ARTIFACT","title":"Output","content":{"text":"...","media_type":"text/plain"}}
Read Artifact: {"artifact_id":"ARTIFACT"}
Node blocker: {"reason":"Owner direction needed"}
Node completion: {"summary":"completed work","artifact_ids":[]}
Omit artifact_ids to select this Attempt's outputs; [] selects none. Artifacts do
not complete work. Completion or block ends the Attempt. Repository-free work needs
no fake repository; opened or retained dirty work must be finalized.
Completion may declare handled_guidance_ids:["GUIDANCE"]. Omission or [] means none;
never infer handling from launch. Include still-required launch-assigned guidance
or use block_node for unresolved work. Exact assignments are validated by backend.
Initial Task Plan: {"planning_intent_id":"INTENT","plan_id":"PLAN","nodes":[{"node_id":"NODE","role_id":"ROLE","goal":"work to perform","dependencies":[]}]}
Initial planning issue: {"planning_intent_id":"INTENT","reason":"Owner direction needed"}
Only the source-bound initial Task Planner may publish a Plan or raise an initial
planning issue. Use its supplied planning_intent_id. Exactly one Node is supported;
preserve optional hard_requirements and expected_outputs when supplied.
Only these two commands end initial planning; commit_task_turn does not.
Task context: {}; current formal facts include the separate action basis.
Task history: {} or {"query":"search text"} or {"cursor":"CURSOR"}; source-cutoff bound.
Task reply: {"source_id":"SOURCE","input_id":"INPUT","source_watermark":1,"reply":"...","routing":{"kind":"reply"}}
Only a canonical Task Conversation source may use these reads or commit this reply.
Its source/version stays fixed; action routing has a separate current execution
basis. Conversation-only sources permit reply routing alone. Conversation cannot
Start/Continue/unblock/reopen work or create another Task.
Specification preparation requires proposal_id, complete specification Markdown, summary,
basis, full impact and source_input_ids; optional supersedes names the replaced proposal.
Preparation without a Plan: {"proposal_id":"PROPOSAL","specification":"# Complete requirement","summary":"Change summary","basis":{"control_version":1,"specification_id":"SPEC","plan_id":null},"impact":{"graph_sufficient":true,"nodes":[],"guidance":[]},"source_input_ids":["INPUT"]}
For a current Node, impact.nodes must cover its exact node_id, node_activation,
source_id (or null), completion_operation_id (or null), completion_manifest_digest
(or null), and disposition: refresh, invalidate or carry. Guidance coverage uses
guidance_id, version and disposition: retain or supersede. Use current formal facts;
never invent impact identities or substitute a new basis into an old assessment.
Only an attached proposal is reviewable: commit_task_turn with specification_proposal
routing after preparation. Preparation does not end the turn or publish requirements.
Specification apply: {"proposal_id":"PROPOSAL","confirmation_id":"EXACT_OWNER_RECEIPT","basis":{"control_version":1,"specification_id":"SPEC","plan_id":null}}
Apply consumes an existing exact Owner confirmation; prose is never authorization.
Its operation reference means admitted settlement, not publication or completed work.
Apply does not end the turn: still commit_task_turn with your canonical reply.
Reply-only sources cannot prepare or apply Specification revisions.
Legacy probe reply: {"reply":"...","source_watermark":1,"routing":{"kind":"reply_only"}}
Todo history: {} or {"cursor":"CURSOR"}; only this Attempt's input cutoff is readable.
Todo cache rebuild: {"working_requirement_state":"...","resolved_watermark":0,"project_context_version":1,"project_context_digest":"64-hex-digest-from-context"}
Todo reply: {"reply":"...","working_requirement_state":"...","source_message_id":"MESSAGE","source_watermark":1}
Only commit_discussion_turn completes a Todo Discussion turn. A history read or
cache rebuild does not consume the Owner's unresolved message.
The Runner derives your scope from the kernel process identity. No scope/PID hints
grant authority. Retry reloads the immutable journaled payload, never your file.
An uncertain response must be reconciled with command-status using the same ID.
`

func call(req local.Request) (local.Response, error) {
	path := os.Getenv("MONOS_SOCKET")
	if path == "" {
		path = host.Socket
	}
	conn, err := net.DialUnix("unix", nil, &net.UnixAddr{Name: path, Net: "unix"})
	if err != nil {
		return local.Response{}, fmt.Errorf("Runner socket unavailable")
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(30 * time.Second))
	if err = json.NewEncoder(conn).Encode(req); err != nil {
		return local.Response{}, err
	}
	if err = conn.CloseWrite(); err != nil {
		return local.Response{}, err
	}
	raw, err := io.ReadAll(io.LimitReader(conn, 2*wire.Limit))
	if err != nil {
		return local.Response{}, err
	}
	var response local.Response
	if err = json.Unmarshal(raw, &response); err != nil {
		return response, err
	}
	if response.Error != "" {
		return response, fmt.Errorf("%s", response.Error)
	}
	return response, nil
}
func run(args []string) (protocol.CommandResult, error) {
	var result protocol.CommandResult
	flags := flag.NewFlagSet("monos", flag.ContinueOnError)
	input := flags.String("input", "", "JSON payload file, or - for stdin")
	requestID := flags.String("request-id", "", "immutable request identity")
	output := flags.String("output", "json", "structured output")
	if len(args) == 0 {
		return result, fmt.Errorf("command required")
	}
	name := strings.ReplaceAll(args[0], "-", "_")
	if err := flags.Parse(args[1:]); err != nil {
		return result, err
	}
	if flags.NArg() != 0 || *output != "json" {
		return result, fmt.Errorf("unexpected arguments/output")
	}
	action := "prepare"
	switch name {
	case "retry":
		action = "retry"
	case "command_status":
		action = "status"
	case "apply_review_rework", "commit_review_feedback", "resolve_review_input", "request_replan", "prepare_replan", "publish_artifact", "read_artifact", "block_node", "open_workspace", "inspect_repository", "complete_node", "publish_execution_plan", "raise_planning_issue", "commit_task_turn", "prepare_specification_revision", "apply_specification_revision", "read_task_context", "read_task_history", "read_discussion", "update_working_requirement_state", "commit_discussion_turn":
	default:
		return result, fmt.Errorf("unknown command")
	}
	if action != "prepare" && *requestID == "" {
		return result, fmt.Errorf("--request-id required")
	}
	if *requestID == "" {
		*requestID = control.ID()
	}
	result.RequestID = requestID
	req := local.Request{Action: action, RequestID: *requestID}
	if action == "prepare" {
		if *input == "" {
			return result, fmt.Errorf("--input required")
		}
		var reader io.Reader = os.Stdin
		if *input != "-" {
			file, err := os.Open(*input)
			if err != nil {
				return result, err
			}
			defer file.Close()
			reader = file
		}
		raw, err := io.ReadAll(io.LimitReader(reader, wire.Limit+1))
		if err != nil {
			return result, err
		}
		if len(raw) > wire.Limit || !json.Valid(raw) {
			return result, fmt.Errorf("invalid or oversized input JSON")
		}
		req.Name = protocol.CommandEnvelopeName(name)
		req.Payload = raw
	} else if *input != "" {
		return result, fmt.Errorf("retry/status cannot read replacement input")
	}
	response, err := call(req)
	if err != nil {
		return result, err
	}
	if response.Result != nil {
		return *response.Result, nil
	}
	client, err := control.NewHTTPClient(response.Endpoint, response.CA)
	if err != nil {
		return result, err
	}
	client.Timeout = 20 * time.Second
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	submitted, err := control.Submit(ctx, client, response.Endpoint, response.Credential, []byte(response.EnvelopeJSON), response.Digest)
	if err != nil {
		return result, err
	}
	return submitted, nil
}
func main() {
	if len(os.Args) == 1 || os.Args[1] == "--help" || os.Args[1] == "help" {
		fmt.Print(help)
		return
	}
	result, err := run(os.Args[1:])
	if err != nil {
		result.SchemaVersion = 1
		result.Status = protocol.StatusError
		result.Error = &protocol.ErrorInfo{Code: protocol.ControlUnavailable, Message: err.Error()}
	}
	_ = json.NewEncoder(os.Stdout).Encode(result)
	if err != nil || result.Status == protocol.StatusError {
		os.Exit(1)
	}
}
