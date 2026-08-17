# Clownfish Privacy Policy

Version: 0.2.3
Effective date: August 17, 2026

Clownfish is a local-first AI work application. The project currently provides no hosted account service, advertising profile, or centralized product telemetry.

## 1. Data stored locally by default

Tasks, conversations, learning records, saved memories, imported files, converted working copies, exports, capability artifacts, development history, settings, approvals, tool receipts, errors, and recovery records are stored under the current Windows user. The default data directory is `~/.clownfish`.

Unless the user enables an external service or synchronization, this data is not uploaded to a server operated by this project.

## 2. When data leaves the device

Data is sent outside the device only when the user configures, enables, or invokes the relevant feature:

- model requests may include the current request, necessary context, selected attachment content, and tool results;
- search and web-reading features send queries and target URLs to the relevant services;
- plugins and connectors receive only the permissions and inputs shown before installation or use;
- coding engines receive the selected project context and may call their configured model provider;
- self-hosted sync uploads a snapshot encrypted on the device to the server selected by the user.

Third-party services process data under their own terms. Do not submit personal data, confidential information, or restricted material that should not be handled by the selected service.

## 3. Credentials

On supported Windows systems, model keys and sync credentials are protected with the current user's operating-system encryption. They are not written into project files, capability artifacts, or sync snapshots. Third-party command-line tools may use their own credential stores and privacy policies.

## 4. Memory

Memory preserves user-stated facts, preferences, and task continuity. User facts, persona content, and separate conversations have distinct boundaries. Test content, attachments, and model inferences are not automatically promoted to permanent user facts. Users can review, correct, invalidate, or delete curated memories.

## 5. Files and development projects

Office and PDF originals are preserved while editing continues in converted copies. TXT and Markdown files are written back only after explicit authorization and conflict checks. Development features operate only on directories selected or linked by the user. Removing an application record does not automatically delete an external project directory.

## 6. Plugins, permissions, and automations

Before installation, plugins disclose their source, permissions, dependencies, and whether they launch local programs. Permission expansion or runtime-structure changes require renewed confirmation. Automations execute only schedules created or enabled by the user and remain subject to the applicable permission rules.

## 7. Self-hosted sync and backups

Local-only mode does not use a sync server. When self-hosted sync is enabled, snapshots are encrypted on the device before upload; local model keys and credentials are excluded. Users are responsible for protecting the sync token and encryption passphrase. A lost passphrase may make server snapshots unrecoverable.

## 8. Retention, export, and deletion

Data remains on the user's device until the user deletes it, archives it, restores a backup, or handles it during uninstall. Users can export files, remove memories, and delete tasks and artifacts. Permanently deleted data without a backup cannot be recovered.

Uninstalling the application does not necessarily remove `~/.clownfish`, external project directories, or exported files.

## 9. Children

Guided learning can be used by minors, but the application does not create advertising profiles from that use. Guardians should decide whether external model services and learning materials are appropriate and should avoid submitting unnecessary identity or contact information.

## 10. Security boundary

The local web service is designed to listen only on the loopback interface and must not be exposed directly to the public internet. No software can guarantee absolute security. Report vulnerabilities through the repository's private GitHub security-reporting channel as described in [SECURITY.md](SECURITY.md), without posting personal data or credentials publicly.

## 11. Changes

Material changes to data disclosure, permissions, or default storage behavior will increase this policy version and be described in the release notes before the affected feature is enabled.

## 12. Contact

Use GitHub Issues for general privacy questions without attaching private data. Use the private security-reporting channel for security incidents or suspected data exposure.
