# Provider grant response reference check

2026-10-04. Read-only primary documentation check during contract freeze.

The [GitHub installation-token endpoint](https://docs.github.com/en/rest/apps/apps?apiVersion=2022-11-28#create-an-installation-access-token-for-an-app)
supports explicit repository IDs and permission downscoping. Its selected-scope
response example includes repository selection and a repositories array, alongside
permissions and expiry. This supports validating the exact requested repository
against authenticated grant facts. It does not establish any live installation
grant in this workspace.

Current `apps/server/src/github.ts` already validates the selected repository,
bounded expiry and read-only permission set. Preserve its encryption contract and
workspace read behavior when adding separate remote-write profiles. Broad or
missing scope facts cannot silently become a verified permission observation.
The root check found no new response-shape reason to weaken these validations.

No documentation example credential, raw provider body or secret was copied into
this report. No provider configuration or mutation occurred. Production App tests
and the explicitly injected OAuth native kernel remain distinct evidence layers.
