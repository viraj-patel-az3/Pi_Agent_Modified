//Viraj's Code Start
# Agent-owned failure recovery design

## 1. Goals

Define a failure-recovery architecture for AgentZ in which each agent type saves, validates, loads, restores, and resumes its own private execution state. Shared infrastructure coordinates ownership and locates opaque checkpoints without interpreting them. The design must support process replacement, at-least-once task delivery, ordered per-agent processing, bounded recovery, and safe replay of external effects.

## 2. Non-goals

This design does not implement Service Bus, replace the existing persistence stores, checkpoint every prompt, persist functions or global JavaScript state, change provider authentication, or allow a coordinator to reconstruct private agent state. It also does not make named local-variable snapshots into complete execution checkpoints.

## 3. Agent-owned state

Each agent type defines its own versioned checkpoint schema and conceptually implements `saveCheckpoint()`, `validateCheckpoint()`, `restoreCheckpoint()`, and `resumeFromCheckpoint()`. A private checkpoint should contain, as appropriate:

- Checkpoint schema version, agent type, and agent instance ID.
- Current task ID, current execution step, next step, and last successfully completed step.
- Agent-local variables, pending local work, and agent-specific restore metadata.
- Completed operation identifiers and tool-call recovery metadata.
- Checkpoint creation and update times.
- Recovery attempt count, last failed step, error fingerprint, and last recovery time.

The exact schema may vary by agent type. Private checkpoint storage must expose opaque bytes or an opaque reference to central infrastructure. Only the matching agent type may validate, migrate, interpret, or restore those bytes.

## 4. Centrally shared metadata

Service Bus, shared memory, or a repository abstraction serving the same purpose may store only coordination metadata:

- Agent ID and agent type.
- Task ID and checkpoint ID or opaque checkpoint reference.
- Checkpoint version as a routing and compatibility hint, not an interpreted schema.
- Status, heartbeat timestamp, lease owner, lease expiration, and recovery attempt.
- Attempt count, message ID, idempotency key, last error category, last error summary, and updated timestamp.

The coordinator may select the correct agent implementation and point it at a checkpoint. It must never extract private variables, infer the next execution step, migrate the checkpoint, or synthesize replacement state.

## 5. Checkpoint lifecycle

Checkpoint at meaningful successful step boundaries. Smaller steps reduce repeated work after a crash but increase write frequency; larger steps reduce writes but repeat more work. The agent chooses boundaries according to side-effect cost and replay safety.

Commit in this order:

```text
prepare checkpoint
-> validate checkpoint
-> write temporary state
-> atomically commit
-> publish opaque checkpoint reference
```

A failed or partial write must leave the previous checkpoint valid. Publishing the new reference is forbidden until the atomic commit succeeds. Retain at least the last known-valid checkpoint until the replacement has been read and validated.

## 6. Normal execution flow

```text
Agent receives task
-> claims ownership
-> loads its latest checkpoint when one exists
-> validates checkpoint
-> restores its private state
-> executes one recoverable step
-> commits external effects idempotently
-> saves a new checkpoint atomically
-> publishes shared checkpoint/status metadata
-> acknowledges the task
-> continues
```

For Service Bus, use Peek Lock. Complete the message only after the recoverable result, agent checkpoint, and published checkpoint reference are durable. Azure documents Peek Lock as at-least-once delivery and recommends completing only after processing succeeds; a lock loss or restart can redeliver the message ([message loss and duplicate processing](https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-message-loss-and-duplicates)).

## 7. Failure flow

```text
Agent fails
-> message lock expires or the task is abandoned
-> shared metadata records the failure
-> retry policy classifies the failure
-> replacement process receives the task
-> correct agent type loads its own checkpoint
-> agent validates and restores its private state
-> agent resumes from the first incomplete step
-> repeated unrecoverable failures move to dead-letter/manual review
```

The replacement process claims coordination ownership, then invokes the matching agent type. It does not restore the state itself. Recovery-loop fields prevent `crash -> restore -> repeat the same failing step` from continuing indefinitely.

## 8. Retry policy

Classify failures as transient, permanent, or unknown. Retry transient failures with exponential backoff and jitter. Set both a maximum attempt count and maximum elapsed duration; log each decision and transition exhausted work to failed or dead-letter status. Permanent failures should skip ordinary retries. Unknown failures receive a small bounded retry allowance before escalation.

The default policy should be conservative and configurable per agent type and operation. The recovery controller should compare the failed step and error fingerprint across attempts and stop early when the same deterministic failure repeats. Azure guidance recommends bounded attempts and duration, increasing delays, and jitter to avoid retry storms ([transient fault guidance](https://learn.microsoft.com/en-us/azure/well-architected/design-guides/handle-transient-faults), [retry storm antipattern](https://learn.microsoft.com/en-us/azure/architecture/antipatterns/retry-storm/)).

## 9. Dead-letter policy

When retry limits are exceeded, preserve the last valid private checkpoint, record the final error category and summary, publish failed coordination metadata, and move or classify the task for dead-letter/manual review. Never delete the checkpoint automatically. A manual replay must create a new recovery attempt with an auditable operator reason. Service Bus can dead-letter after maximum delivery count, but the application should directly dead-letter known permanent failures instead of consuming transient retry capacity ([background job guidance](https://learn.microsoft.com/en-us/azure/architecture/best-practices/background-jobs)).

## 10. Heartbeat and lease handling

Shared coordination tracks owner agent ID, last heartbeat, lease expiration, and recovery attempt for long-running work. Heartbeats extend only a currently owned lease. After expiration, a replacement process may atomically claim the task, locate the opaque checkpoint, and invoke the correct agent type. Use fencing tokens or a monotonically increasing lease generation so a delayed former owner cannot publish a checkpoint or complete work after ownership changes.

Service Bus locks should be renewed only while the owner is healthy. Lock renewal does not replace application-level lease metadata because checkpoint publication and non-Service-Bus side effects also require stale-owner protection.

## 11. Idempotency strategy

Assume every task can be delivered more than once. Give each external effect a stable operation ID derived from agent ID, task ID, step ID, and operation purpose. Pass a stable idempotency key to downstream systems when supported and store completed operation identifiers in the private checkpoint ledger. Before replay, the agent checks the ledger and, where necessary, queries the downstream result.

Use a deterministic Service Bus `MessageId`, such as `taskId:operationId`, and enable broker duplicate detection when the selected tier supports it. Broker duplicate detection covers only a configured send-side window and does not replace consumer idempotency. Microsoft recommends business-context message IDs that can be reconstructed after failure ([duplicate detection](https://learn.microsoft.com/en-us/azure/service-bus-messaging/duplicate-detection)).

## 12. Service Bus session-key recommendation

Use the stable logical **agent ID** as `SessionId`. Agent ID aligns the exclusive session lock with the owner of private state, preserves order across all tasks that mutate that logical agent, and prevents two Service Bus receivers from concurrently restoring it. Task ID would allow separate tasks for one agent to execute concurrently, risking private-state races. Workflow ID is appropriate only if a workflow, rather than an agent, is the true single-writer state boundary.

Put agent type in application properties for routing, task ID in application properties and the body, and use a deterministic `MessageId`/idempotency key per logical operation. Service Bus sessions provide ordered delivery and an exclusive lock for a session; broker session state is opaque and may hold a reference to external state ([message sessions](https://learn.microsoft.com/en-us/azure/service-bus-messaging/message-sessions)). Store only the checkpoint reference and coordination metadata there, not private checkpoint contents that central code interprets.

## 13. Shared-memory alternative

For a single-host deployment, a shared-memory coordination table can implement the same contract: compare-and-swap claims, lease generation, heartbeat, status, retry counters, error summary, and opaque checkpoint reference. It must be process-safe and durable enough for the required failure domain. In-memory-only coordination cannot recover from a host restart; use an existing durable repository abstraction if host failure recovery is required. Private state remains in agent-owned checkpoint storage and is never copied into the shared table.

## 14. Schema versioning

Every private checkpoint contains a schema version. The agent validates integrity and supported versions before mutating active state. Older versions migrate only through explicit agent-owned migration functions. Write migrated state as a new checkpoint; preserve the original until the new checkpoint validates and commits. Reject unknown future versions and corrupt state safely. The shared checkpoint version is informational for routing and diagnostics, not permission for the coordinator to migrate data.

## 15. Security considerations

Encrypt private checkpoints at rest when they may contain secrets, restrict storage access to the matching agent identity, and avoid placing private values or credentials in Service Bus properties, shared memory, logs, error summaries, or checkpoint names. Authenticate and authorize publishers and consumers with least privilege. Treat checkpoint references as sensitive capabilities, validate agent/task binding before load, protect integrity with authenticated storage or a digest, and apply retention and deletion policies independently to private checkpoints and coordination records.

## 16. Corruption handling

Validate envelope identity, schema version, required fields, value constraints, and integrity before restore. Restore into isolated candidate state and swap it into active state only after complete validation. On corruption, leave active state and the previous valid checkpoint unchanged, publish a sanitized failure category, and try an earlier known-valid checkpoint only through an explicit agent policy. Never have central infrastructure repair or partially deserialize agent state.

## 17. Relationship to `/persist session`

`LocalStateStore` owns active local-variable state for one `AgentSession`. `NamedLocalStateStore` creates manually named or time-named local-variable checkpoints and atomically replaces its registry through a temporary file and rename. `/persist session [name]` asks the active agent session to serialize its marked local variables into that store.

These snapshots contain local variables and persistent names plus snapshot metadata. They are useful agent-owned state fragments, but they are not complete execution-recovery checkpoints: they omit current workflow step, pending task, tool-operation identifiers, retry metadata, heartbeat, lease ownership, idempotency records, and failure classification. The recovery design should compose with these stores rather than redesign them.

## 18. Relationship to `/restoresession`

`/restoresession <name>` asks the active `AgentSession` to retrieve a snapshot and merge validated variables into its own local state. `/restoresession list` uses the central registry only to locate and summarize snapshots. This is consistent with agent ownership: the registry locates a checkpoint, while the active agent session validates and applies its state. Future execution recovery needs a separate agent-type checkpoint contract and must not make the registry interpret execution semantics or automatically restore unrelated agents.

## 19. Phased implementation plan

1. Define an agent checkpoint interface, opaque storage contract, schema envelope, integrity checks, and per-agent migration registry. Keep existing local-variable persistence unchanged.
2. Add step-boundary execution metadata and a completed-operation ledger to one agent type. Test crash points before and after side effects and checkpoint commit.
3. Add a local durable coordination implementation with atomic claims, fencing leases, heartbeats, bounded retries, failure fingerprints, and manual dead-letter inspection.
4. Add idempotency adapters for individual tools and external services, with stable operation IDs and replay tests.
5. If deployment requirements justify it, introduce Service Bus behind the coordination interface after dependency, security, and operational review. Use Peek Lock, agent-ID sessions, deterministic message IDs, checkpoint-before-complete ordering, and dead-letter monitoring.
6. Run fault-injection and migration tests covering corrupt checkpoints, stale owners, lock loss, duplicate delivery, partial writes, failed migrations, and repeated deterministic crashes before enabling automatic recovery broadly.

## 20. Open questions

- Is logical agent ID always the single-writer boundary, or can one agent safely execute independent tasks concurrently?
- Which storage provides durable opaque private checkpoints, retention, encryption, and compare-and-swap metadata?
- Which operations already support idempotency keys, and which require a result ledger or reconciliation query?
- What default attempt and elapsed-time budgets apply to each error category and tool?
- How long should valid, failed, superseded, and dead-letter checkpoints be retained?
- Who may manually replay or discard dead-letter work, and what audit record is required?
- Should an agent fall back to an older checkpoint automatically after corruption, or require operator approval?
- What checkpoint size and write-rate budgets are acceptable for each agent type?
//Viraj's Code End
