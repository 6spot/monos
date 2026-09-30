# Implementation plan

1. Obtain approval of the final planning summary, then activate this task through task.py start. Recheck current contents/status of all affected files before editing.
2. Main session applies the shared specification changes using trellis-update-spec: product UI/technology docs, new visual-design spec, frontend index/component/directory/quality guidance. Preserve domain rules and clarify existing versus target behavior.
3. Update the seven active task PRDs from the audit map, retaining all functional criteria and statuses. Curate execution UI implement/check contexts with the new visual contract and component/quality guidance.
4. Write the existing-screen migration handoff with ownership, listed surfaces, dependencies and observable acceptance; link it from the task-execution parent and integrated acceptance. Do not create/start a migration task.
5. Review the complete documentation diff. Check relative Markdown links and all changed JSONL file targets, run git diff --check, and verify no product files, archived evidence or task statuses were modified by the alignment work. Distinguish any pre-existing broken link from changes introduced here.
6. Dispatch the required scoped Trellis quality review after activation, supplying current task and curated spec/research context; address findings. No application build/browser test is claimed for documentation-only work.
7. Record actual verification and completion state; report that existing screens still require their separate migration. Follow project finish workflow without staging unrelated changes.

## Acceptance review

Cross-check R1–R6 / AC1–AC6 in the PRD. Verify each audit-map task links to the canonical specification, new UI contexts are nonempty, and screenshots require visual inspection rather than mere capture. Ensure no implied new theme-switching/resizing/team feature slipped into scope.
