export const hardenedCodexConfigOverrides = {
  "cli_auth_credentials_store": "file",
  web_search: "disabled",
  "history.persistence": "none",
  "feedback.enabled": false,
  "features.apps": false,
  "features.auth_elicitation": false,
  "features.browser_use": false,
  "features.browser_use_external": false,
  "features.browser_use_full_cdp_access": false,
  "features.code_mode": false,
  "features.code_mode_host": false,
  "features.computer_use": false,
  "features.hooks": false,
  "features.image_generation": false,
  "features.js_repl": false,
  "features.memories": false,
  "features.multi_agent": false,
  "features.multi_agent_v2": false,
  "features.plugins": false,
  "features.remote_plugin": false,
  "features.recommended_plugins": false,
  "features.shell_snapshot": false,
  "features.shell_tool": false,
  "features.skill_mcp_dependency_install": false,
  "features.skill_search": false,
  "features.tool_call_mcp_elicitation": false,
  "features.tool_suggest": false,
  "features.unified_exec": false,
  "features.view_image": false,
  "features.workspace_dependencies": false,
  "tools.web_search": false,
  "tools.view_image": false,
} as const

export const codexLoginConfig = `cli_auth_credentials_store = "file"
web_search = "disabled"

[history]
persistence = "none"

[feedback]
enabled = false

[features]
apps = false
auth_elicitation = false
browser_use = false
browser_use_external = false
browser_use_full_cdp_access = false
code_mode = false
code_mode_host = false
computer_use = false
hooks = false
image_generation = false
js_repl = false
memories = false
multi_agent = false
multi_agent_v2 = false
plugins = false
remote_plugin = false
recommended_plugins = false
shell_snapshot = false
shell_tool = false
skill_mcp_dependency_install = false
skill_search = false
tool_call_mcp_elicitation = false
tool_suggest = false
unified_exec = false
view_image = false
workspace_dependencies = false

[tools]
web_search = false
view_image = false
`
