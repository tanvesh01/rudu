#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum RuduToolCapability {
    ReadOnly,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct RuduMcpTool {
    pub(super) server_name: &'static str,
    pub(super) tool_name: &'static str,
    pub(super) capability: RuduToolCapability,
}

const LINEAR_SERVER_NAME: &str = "rudu-linear";
const LINEAR_ISSUE_DETAILS_TOOL_NAME: &str = "get_linear_issue_details";

pub(super) fn linear_issue_details_tool() -> RuduMcpTool {
    RuduMcpTool {
        server_name: LINEAR_SERVER_NAME,
        tool_name: LINEAR_ISSUE_DETAILS_TOOL_NAME,
        capability: RuduToolCapability::ReadOnly,
    }
}

pub(super) fn capability_for_mcp_tool(
    server_name: &str,
    tool_name: &str,
) -> Option<RuduToolCapability> {
    let tool = linear_issue_details_tool();
    if server_name == tool.server_name && tool_name.contains(tool.tool_name) {
        return Some(tool.capability);
    }

    None
}

#[cfg(test)]
mod tests {
    use super::{capability_for_mcp_tool, linear_issue_details_tool, RuduToolCapability};

    #[test]
    fn declares_linear_issue_details_as_read_only() {
        let tool = linear_issue_details_tool();

        assert_eq!(tool.server_name, "rudu-linear");
        assert_eq!(tool.tool_name, "get_linear_issue_details");
        assert_eq!(tool.capability, RuduToolCapability::ReadOnly);
        assert_eq!(
            capability_for_mcp_tool("rudu-linear", "get_linear_issue_details"),
            Some(RuduToolCapability::ReadOnly)
        );
    }
}
