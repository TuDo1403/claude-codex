# Privilege Graph (Critical Path)

Use this to map all privileged actions and ensure they are tested.

## Steps
- Enumerate all roles and permissions (owner, guardian, admin, operator, keeper).
- Map each privileged function to assets or state it can affect.
- Identify upgrade and pause capabilities and their scope.

## Test requirement
- For every privileged action, add at least one test proving constraints hold.
- Include negative tests for unauthorized roles.
