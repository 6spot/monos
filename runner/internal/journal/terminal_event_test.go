package journal

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"

	protocol "monos.local/protocol"
)

func TestTerminalEventRetainsExactACKedProofAcrossReopenAndDeliveryBatch(t *testing.T) {
	dir := t.TempDir()
	if err := os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "journal.sqlite")
	db, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	failure := protocol.NativeTerminalError
	original, err := db.Event(protocol.RuntimeEvent{AttemptID: "a", DispatchID: "d", StreamID: "runtime", Kind: protocol.Exited, RuntimeFailure: &failure})
	if err != nil {
		t.Fatal(err)
	}
	if err = db.Ack("a", "runtime", original.Sequence); err != nil {
		t.Fatal(err)
	}
	// A delivery batch neither includes this ACKed event nor all retained rows.
	for range 260 {
		if _, err = db.Event(protocol.RuntimeEvent{AttemptID: "b", DispatchID: "other", StreamID: "stdout", Kind: protocol.Output, Text: "later"}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = db.Event(protocol.RuntimeEvent{AttemptID: "a", DispatchID: "other", StreamID: "runtime", Kind: protocol.Exited}); err != nil {
		t.Fatal(err)
	}
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}
	db, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	retained, found, err := db.TerminalEvent("a", "d", protocol.Exited)
	if err != nil || !found || !reflect.DeepEqual(retained, original) {
		t.Fatal("lost immutable ACKed proof", retained, found, err)
	}
	other, found, err := db.TerminalEvent("a", "other", protocol.Exited)
	if err != nil || !found || other.RuntimeFailure != nil {
		t.Fatal("foreign dispatch inherited proof", other, err)
	}
	for _, identity := range [][2]string{{"a", "missing"}, {"missing", "d"}} {
		if _, found, err = db.TerminalEvent(identity[0], identity[1], protocol.Exited); err != nil || found {
			t.Fatal("missing identity matched terminal proof", identity, found, err)
		}
	}
	if _, found, err = db.TerminalEvent("a", "d", protocol.ProcessAbsent); err != nil || found {
		t.Fatal("exit became whole-tree absence", found, err)
	}
	if _, _, err = db.TerminalEvent("a", "d", protocol.Output); err == nil {
		t.Fatal("nonterminal event accepted as terminal proof")
	}
}
