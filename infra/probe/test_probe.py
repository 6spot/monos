"""Acceptance-checker regressions; these do not establish Linux/CLI acceptance."""
import copy
import json
import pathlib
import tempfile
import time
import unittest
from unittest.mock import patch

import driver
import probe


def completed_state(kind="node"):
    identity = {"dispatch_id": "dispatch-one", "pid": 123, "birth": "12345", "boot_id": "old-boot", "cgroup": "/system.slice/monos-probe-a-one.service", "phase": "absent"}
    receipt = lambda request, command, operation, status: {"request_id": request, "scope_id": "task_one", "command_name": command, "operation_id": operation, "status": status, "digest": request, "long_value_length": 160000, "reply_length": 160000 if kind == "planner" else None}
    state = {
        "attempts": [{"attempt_id": "one", "dispatch_id": "dispatch-one", "kind": kind, "started": True, "mutation_allowed": False, "process_absent": True, "process_released": True, "task_state": "REVIEW", "node_state": "COMPLETED"}],
        "driver": {"attempt_id": "one", "kind": kind, "execution_uid": 1000, "stage": "handoff_submitting", "handoff_request_id": "probe-handoff", "expected_git_tree": "tree", "checks": {key: True for key in probe.COMMON_CHECKS | probe.KIND_CHECKS[kind]}},
        "receipts": [receipt("shared-open", "open_workspace" if kind == "node" else "inspect_repository", "open-op", "admitted"), receipt("probe-handoff", "complete_node" if kind == "node" else "commit_task_turn", "handoff-op", "admitted" if kind == "node" else "committed")],
        "operations": [{"operation_id": "open-op", "kind": "open_workspace" if kind == "node" else "inspect_repository", "state": "succeeded"}, {"operation_id": "handoff-op", "kind": "complete_node" if kind == "node" else "stop", "state": "succeeded", "writer_absent": True, "git_commit": "commit", "git_tree": "tree"}],
        "journal_requests": [{"request_id": request, "digest": request, "digest_matches_bytes": True, "bytes": 160250} for request in ("shared-open", "probe-handoff")],
        "ownership": identity, "live_identity": {"present": False}, "boot_id": "old-boot", "events": [{"kind": "started", "stream_id": "runtime", "sequence": 1}],
        "physical": {"cgroup_populated": False, "descendants": [{"name": name, "alive": False, "identity": identity.copy()} for name in ("setsid", "double-fork")]},
    }
    return state


class AcceptanceTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.directory.name)
        self.root_patch = patch.object(probe, "ROOT", self.root)
        self.root_patch.start()
        self.sleep_patch = patch.object(probe.time, "sleep")
        self.sleep_patch.start()
        self.instance = probe.Probe.__new__(probe.Probe)
        self.instance.config = {"execution_uid": 1000}
        scratch = self.root / "execution/one/scratch"
        scratch.mkdir(parents=True)
        for name in ("setsid", "double-fork"):
            (scratch / (name + ".sentinel")).write_text("observed")

    def tearDown(self):
        self.sleep_patch.stop()
        self.root_patch.stop()
        self.directory.cleanup()

    def test_complete_node_and_planner_evidence_pass(self):
        for kind in ("node", "planner"):
            with self.subTest(kind=kind):
                self.assertEqual(self.instance.verify("one", completed_state(kind))["outcome"], "pass")

    def test_every_required_driver_check_is_mandatory(self):
        for kind in ("node", "planner"):
            for check in probe.COMMON_CHECKS | probe.KIND_CHECKS[kind]:
                state = completed_state(kind)
                del state["driver"]["checks"][check]
                with self.subTest(kind=kind, check=check):
                    self.assertEqual(self.instance.verify("one", state)["outcome"], "fail")

    def test_empty_or_incomplete_driver_never_passes(self):
        state = completed_state()
        state["driver"] = None
        self.assertEqual(self.instance.verify("one", state)["outcome"], "fail")

    def test_planner_requires_committed_reply_and_physical_stop(self):
        for field, value in (("status", "admitted"), ("reply_length", 159999), ("command_name", "complete_node")):
            state = completed_state("planner")
            state["receipts"][1][field] = value
            with self.subTest(field=field):
                self.assertEqual(self.instance.verify("one", state)["outcome"], "fail")

    def test_missing_or_mismatched_retained_handoff_fails(self):
        for change in ("missing", "digest"):
            state = completed_state()
            if change == "missing":
                state["journal_requests"].pop()
            else:
                state["journal_requests"][1]["digest"] = "changed"
            self.assertEqual(self.instance.verify("one", state)["outcome"], "fail")

    def test_live_or_unknown_cgroup_cannot_pass_released_claim(self):
        for population in (True, None):
            state = completed_state()
            state["physical"]["cgroup_populated"] = population
            self.assertEqual(self.instance.verify("one", state)["outcome"], "fail")

    def test_unchanged_sentinel_does_not_prove_descendant_absence(self):
        state = completed_state()
        state["physical"]["descendants"][0]["alive"] = True
        self.assertEqual(self.instance.verify("one", state)["outcome"], "fail")

    def test_forged_hints_need_specific_rejection_not_unknown_request(self):
        with patch.object(driver, "local_request", return_value={"error": "unknown retained request"}):
            self.assertFalse(driver.forged_hints_denied("other"))
        with patch.object(driver, "local_request", return_value={"error": 'json: unknown field "attempt_id"'}):
            self.assertTrue(driver.forged_hints_denied("other"))
        with patch.object(driver, "local_request", return_value={"error": 'json: unknown field "attempt_id"', "credential": "must-not-be-granted"}):
            self.assertFalse(driver.forged_hints_denied("other"))

    def reboot_states(self):
        previous = completed_state()
        previous["ownership"]["phase"] = "running"
        previous["live_identity"] = {**previous["ownership"], "present": True, "uid": 1000}
        previous["physical"]["cgroup_populated"] = True
        for child in previous["physical"]["descendants"]:
            child["alive"] = True
        previous["driver"]["stage"] = "ready_for_handoff"
        previous["driver"]["hold_expires_at"] = time.time() + 300
        previous["attempts"][0].update(mutation_allowed=True, process_absent=False, process_released=False, task_state="RUNNING", node_state="RUNNING")
        previous["receipts"].pop()
        previous["operations"].pop()
        before = {"outcome": "ready", "trial": {"attempt_id": "one"}, "checks": self.instance.hold_checks("one", previous), "state": previous}
        after = copy.deepcopy(previous)
        after["boot_id"] = "new-boot"
        after["ownership"]["phase"] = "absent"
        after["live_identity"] = {"present": False}
        after["physical"]["cgroup_populated"] = False
        for child in after["physical"]["descendants"]:
            child["alive"] = False
        after["attempts"][0].update(mutation_allowed=False, process_absent=True, process_released=True, task_state="BLOCKED", node_state="BLOCKED")
        after["operations"].append({"operation_id": "stop-op", "kind": "stop", "state": "succeeded", "writer_absent": True})
        return before, after

    def test_live_checkpoint_and_reboot_recovery(self):
        before, after = self.reboot_states()
        self.assertTrue(all(before["checks"].values()), before["checks"])
        self.assertEqual(self.instance.reboot_verify("one", before, after)["outcome"], "pass")

    def test_same_boot_or_replacement_identity_never_passes_reboot(self):
        for change in ("boot", "pid", "dispatch"):
            before, after = self.reboot_states()
            if change == "boot":
                after["boot_id"] = before["state"]["boot_id"]
            elif change == "pid":
                after["ownership"]["pid"] += 1
            else:
                after["attempts"][0]["dispatch_id"] = "replacement"
            self.assertEqual(self.instance.reboot_verify("one", before, after)["outcome"], "fail")

    def test_unsent_request_must_not_be_admitted_after_reboot(self):
        before, after = self.reboot_states()
        after["receipts"].append(completed_state()["receipts"][1])
        self.assertEqual(self.instance.reboot_verify("one", before, after)["outcome"], "fail")

    def test_reboot_verification_is_pure(self):
        before, after = self.reboot_states()
        originals = copy.deepcopy((before, after))
        self.instance.reboot_verify("one", before, after)
        self.assertEqual((before, after), originals)

    def test_reboot_does_not_pass_changed_request_or_incomplete_stop(self):
        for change in ("digest", "stop", "new_start"):
            before, after = self.reboot_states()
            if change == "digest":
                after["journal_requests"][1]["digest"] = "changed"
            elif change == "stop":
                after["operations"][-1]["writer_absent"] = False
            else:
                after["events"].append({"kind": "started", "sequence": 2})
            self.assertEqual(self.instance.reboot_verify("one", before, after)["outcome"], "fail")

    def test_live_identity_does_not_turn_permission_errors_into_absence(self):
        with patch.object(pathlib.Path, "read_text", side_effect=PermissionError):
            with self.assertRaises(PermissionError):
                probe.live_identity({"pid": 123})

    def test_evidence_refuses_overwrite(self):
        self.instance.evidence = self.root
        self.instance.save("retained", {"outcome": "fail"})
        with self.assertRaises(FileExistsError):
            self.instance.save("retained", {"outcome": "pass"})
        self.assertEqual(json.loads((self.root / "retained.json").read_text())["outcome"], "fail")

    def prepare_start(self):
        self.instance.source = self.root
        self.instance.evidence = self.root
        self.instance.runner = "runner-a"
        scripts = self.root / "infra/probe"
        scripts.mkdir(parents=True)
        for name in ("probe.py", "driver.py", "transport.py"):
            (scripts / name).write_text("fixture")

    def test_idle_restart_refuses_live_claim_without_service_changes(self):
        with patch.object(self.instance, "query", return_value=["live"]), patch.object(self.instance, "call") as call:
            with self.assertRaises(RuntimeError):
                self.instance.idle_restart("one")
            call.assert_not_called()

    def test_idle_restart_detects_lost_receipt_after_restart(self):
        self.instance.evidence = self.root
        self.instance.compose = ["docker", "compose"]
        before = completed_state()
        after = copy.deepcopy(before)
        after["receipts"].pop()
        with patch.object(self.instance, "query", return_value=[]), patch.object(self.instance, "snapshot", side_effect=[before, after]), patch.object(self.instance, "recovery", return_value={"status": "committed"}), patch.object(self.instance, "call", return_value="active\n"):
            result = self.instance.idle_restart("one")
        self.assertEqual(result["outcome"], "fail")
        self.assertFalse(result["checks"]["receipts_unchanged"])
        self.assertEqual(json.loads((self.root / "before-idle-restart-one.json").read_text())["state"], before)

    def test_idle_restart_does_not_restart_if_checkpoint_fails(self):
        with patch.object(self.instance, "query", return_value=[]), patch.object(self.instance, "snapshot", return_value=completed_state()), patch.object(self.instance, "recovery", return_value={"status": "committed"}), patch.object(self.instance, "save", side_effect=OSError), patch.object(self.instance, "call") as call:
            with self.assertRaises(OSError):
                self.instance.idle_restart("one")
            call.assert_not_called()

    def test_lost_admission_response_retains_prepared_evidence(self):
        self.prepare_start()
        with patch.object(self.instance, "catalog", return_value={"id": probe.MODEL}), patch.object(self.instance, "install_driver"), patch.object(self.instance, "admin", side_effect=TimeoutError):
            with self.assertRaises(TimeoutError):
                self.instance.start("one", "node")
        saved = json.loads((self.root / "prepared-one.json").read_text())
        self.assertEqual(saved["attempt_id"], "one")
        self.assertNotIn("dispatch_id", saved)
        self.assertFalse((self.root / "started-one.json").exists())

    def test_evidence_write_failure_prevents_admission(self):
        self.prepare_start()
        with patch.object(self.instance, "catalog", return_value={}), patch.object(self.instance, "install_driver"), patch.object(self.instance, "save", side_effect=OSError), patch.object(self.instance, "admin") as admin:
            with self.assertRaises(OSError):
                self.instance.start("one", "node")
            admin.assert_not_called()

    def test_acknowledged_start_survives_later_caller_loss_and_refuses_rerun(self):
        self.prepare_start()
        with patch.object(self.instance, "catalog", return_value={}), patch.object(self.instance, "install_driver"), patch.object(self.instance, "admin", return_value={"dispatch_id": "dispatch-one"}) as admin:
            trial = self.instance.start("one", "node", hold=True, peer_attempt="two")
            self.assertEqual(json.loads((self.root / "started-one.json").read_text()), trial)
            self.assertEqual(trial["peer_attempt"], "two")
            with self.assertRaises(FileExistsError):
                self.instance.start("one", "node")
            self.assertEqual(admin.call_count, 1)


if __name__ == "__main__":
    unittest.main()
