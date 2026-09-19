/**
 * Eval alias for the shipped six-principles ASK_AGENT_SYSTEM.
 * Kept so `--system candidate` still works after the production swap.
 */

import { ASK_AGENT_SYSTEM } from "../../lib/staffless/ask-copy";

export const ASK_CANDIDATE_SYSTEM = ASK_AGENT_SYSTEM;
