// Package local supplies per-operation kernel-attributed journal/credential access.
package local

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"strings"
	"time"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/control"
	"monos.local/runner/internal/host"
	"monos.local/runner/internal/journal"
	"monos.local/runner/internal/wire"
)

type Request struct {
	Action    string                       `json:"action"`
	Name      protocol.CommandEnvelopeName `json:"name,omitempty"`
	RequestID string                       `json:"request_id,omitempty"`
	Payload   json.RawMessage              `json:"payload,omitempty"`
}
type Response struct {
	Error        string                  `json:"error,omitempty"`
	EnvelopeJSON string                  `json:"envelope_json,omitempty"`
	Digest       string                  `json:"sha256,omitempty"`
	Credential   string                  `json:"credential,omitempty"`
	Endpoint     string                  `json:"endpoint,omitempty"`
	CA           []byte                  `json:"ca,omitempty"`
	Result       *protocol.CommandResult `json:"result,omitempty"`
}
type Service struct {
	DB      *journal.DB
	Control *control.Client
	UID     uint32
}

func Match(p host.Peer, s journal.Start) bool {
	return p.BootID == s.BootID && p.Birth != "" && s.Cgroup != "" && (p.Cgroup == s.Cgroup || strings.HasPrefix(p.Cgroup, s.Cgroup+"/")) && s.Phase == "running"
}
func (s *Service) attribute(conn *net.UnixConn) (journal.Start, error) {
	peer, err := host.SocketPeer(conn)
	if err != nil {
		return journal.Start{}, err
	}
	if peer.UID != s.UID {
		return journal.Start{}, fmt.Errorf("denied execution identity")
	}
	starts, err := s.DB.Starts()
	if err != nil {
		return journal.Start{}, err
	}
	var matched *journal.Start
	for _, start := range starts {
		if Match(peer, start) {
			if matched != nil {
				return journal.Start{}, fmt.Errorf("ambiguous process ownership")
			}
			v := start
			matched = &v
		}
	}
	if matched == nil {
		return journal.Start{}, fmt.Errorf("process not attributed")
	}
	// Verify the peer still denotes the same live process immediately before service work.
	now, err := host.Identity(peer.PID)
	if err != nil || now.Birth != peer.Birth || now.BootID != peer.BootID || now.Cgroup != peer.Cgroup {
		return journal.Start{}, fmt.Errorf("process identity changed")
	}
	return *matched, nil
}
func (s *Service) Handle(ctx context.Context, conn *net.UnixConn, r Request) (Response, error) {
	start, err := s.attribute(conn)
	if err != nil {
		return Response{}, err
	}
	d := start.Dispatch
	if !host.ValidID(r.RequestID) {
		return Response{}, fmt.Errorf("valid request ID required")
	}
	if r.Action == "status" {
		if r.Name != "" || len(r.Payload) > 0 {
			return Response{}, fmt.Errorf("status cannot replace command data")
		}
		var result protocol.CommandResult
		err = s.Control.Get(ctx, "/v1/recovery/attempts/"+d.AttemptID+"/commands/"+r.RequestID, "CommandResult", &result)
		return Response{Result: &result}, err
	}
	var retained journal.Request
	switch r.Action {
	case "prepare":
		raw, e := prepareEnvelope(d, r)
		if e != nil {
			return Response{}, e
		}
		retained, err = s.DB.PutRequest(d.AttemptID, raw)
	case "retry":
		if r.Name != "" || len(r.Payload) > 0 {
			return Response{}, fmt.Errorf("retry cannot replace original envelope")
		}
		retained, err = s.DB.Request(d.AttemptID, r.RequestID)
	default:
		return Response{}, fmt.Errorf("unsupported local operation")
	}
	if err != nil {
		return Response{}, err
	}
	// Persistence precedes authorization and send permission. No bearer is stored.
	if _, err = s.attribute(conn); err != nil {
		return Response{}, err
	}
	credential, err := s.Control.Authorize(ctx, d.DispatchID)
	if err != nil {
		var result protocol.CommandResult
		if readErr := s.Control.Get(ctx, "/v1/recovery/attempts/"+d.AttemptID+"/commands/"+r.RequestID, "CommandResult", &result); readErr == nil && result.Status != "unknown" {
			return Response{Result: &result}, nil
		}
		return Response{}, err
	}
	ca, err := os.ReadFile(s.Control.Config.CAFile)
	if err != nil {
		return Response{}, err
	}
	return Response{EnvelopeJSON: string(retained.Raw), Digest: retained.Digest, Credential: credential, Endpoint: s.Control.Config.Endpoint, CA: ca}, nil
}

func prepareEnvelope(d protocol.Dispatch, r Request) ([]byte, error) {
	scope, err := wire.ScopeID(d)
	if err != nil {
		return nil, err
	}
	conversationRead := r.Name == "read_task_context" || r.Name == "read_task_history"
	if conversationRead && d.TaskConversationSource == nil {
		return nil, fmt.Errorf("Task conversation reads require exact canonical source")
	}
	if d.TaskConversationSource != nil {
		s := d.TaskConversationSource
		switch r.Name {
		case "read_task_context", "read_task_history":
		case "commit_task_turn":
			var payload struct {
				SourceID        string `json:"source_id"`
				InputID         string `json:"input_id"`
				SourceWatermark int64  `json:"source_watermark"`
				Routing         struct {
					Kind string `json:"kind"`
				} `json:"routing"`
			}
			if err := json.Unmarshal(r.Payload, &payload); err != nil || payload.SourceID != s.SourceID || payload.InputID != s.InputID || payload.SourceWatermark != s.SourceWatermark {
				return nil, fmt.Errorf("Task turn source does not match this Attempt")
			}
			if s.ReplyOnly && payload.Routing.Kind != "reply" {
				return nil, fmt.Errorf("this Task conversation source permits reply-only routing")
			}
		default:
			return nil, fmt.Errorf("command unavailable to Task conversation")
		}
	} else if r.Name == "commit_task_turn" {
		if d.TodoID != nil {
			return nil, fmt.Errorf("Task reply is unavailable to Todo Discussion")
		}
		var payload map[string]json.RawMessage
		if err := json.Unmarshal(r.Payload, &payload); err != nil {
			return nil, err
		}
		if _, ok := payload["source_id"]; ok {
			return nil, fmt.Errorf("canonical Task turn requires a conversation source")
		}
		if _, ok := payload["input_id"]; ok {
			return nil, fmt.Errorf("canonical Task turn requires a conversation source")
		}
		var routing struct {
			Kind string `json:"kind"`
		}
		if err := json.Unmarshal(payload["routing"], &routing); err != nil || routing.Kind != "reply_only" {
			return nil, fmt.Errorf("canonical Task routing requires a conversation source")
		}
	}
	nodeCommand := r.Name == "publish_artifact" || r.Name == "read_artifact" || r.Name == "block_node"
	if nodeCommand && d.NodeExecutionSource == nil {
		return nil, fmt.Errorf("command requires canonical Node execution source")
	}
	if d.NodeExecutionSource != nil {
		switch r.Name {
		case "publish_artifact", "read_artifact", "block_node", "complete_node", "open_workspace":
		default:
			return nil, fmt.Errorf("command unavailable to Node execution")
		}
	}
	initialOutcome := r.Name == protocol.PublishExecutionPlan || r.Name == protocol.RaisePlanningIssue
	if initialOutcome {
		if d.TaskPlanningSource == nil {
			return nil, fmt.Errorf("initial planning command requires a source-bound Task Planner")
		}
		var payload struct {
			PlanningIntentID string `json:"planning_intent_id"`
		}
		if err := json.Unmarshal(r.Payload, &payload); err != nil || payload.PlanningIntentID != d.TaskPlanningSource.IntentID {
			return nil, fmt.Errorf("planning intent does not match this Attempt")
		}
	} else if d.TaskPlanningSource != nil && r.Name != protocol.NameInspectRepository {
		return nil, fmt.Errorf("initial Task planning ends only with publish_execution_plan or raise_planning_issue")
	}
	env := map[string]any{"schema_version": 1, "request_id": r.RequestID, "scope_id": scope, "name": r.Name, "expected_control_version": d.ControlVersion, "payload": r.Payload}
	raw, _, err := wire.Canonical(env)
	return raw, err
}

func (s *Service) Serve(ctx context.Context, path string) error {
	listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: path, Net: "unix"})
	if err != nil {
		return err
	}
	defer listener.Close()
	if err = os.Chmod(path, 0660); err != nil {
		return err
	}
	go func() { <-ctx.Done(); listener.Close() }()
	slots := make(chan struct{}, 32)
	for {
		conn, err := listener.AcceptUnix()
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return err
		}
		select {
		case slots <- struct{}{}:
			go func() {
				defer func() { <-slots }()
				defer conn.Close()
				conn.SetDeadline(time.Now().Add(30 * time.Second))
				raw, e := io.ReadAll(io.LimitReader(conn, wire.Limit+1))
				var response Response
				if e == nil && len(raw) <= wire.Limit {
					var req Request
					dec := json.NewDecoder(bytes.NewReader(raw))
					dec.DisallowUnknownFields()
					e = dec.Decode(&req)
					if e == nil {
						var extra any
						if dec.Decode(&extra) != io.EOF {
							e = fmt.Errorf("trailing local input")
						}
					}
					if e == nil {
						response, e = s.Handle(ctx, conn, req)
					}
				} else {
					e = fmt.Errorf("invalid local request")
				}
				if e != nil {
					response = Response{Error: e.Error()}
				}
				_ = json.NewEncoder(conn).Encode(response)
			}()
		default:
			conn.Close()
		}
	}
}
