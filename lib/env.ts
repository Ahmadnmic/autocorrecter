// API keys, accepting the short variable names as well as the canonical ones.
const clean = (v?: string) => (v ?? "").trim().replace(/^["']|["']$/g, "").replace(/^Bearer\s+/i, "");
export const jevKey = () => clean(process.env.JEV_API_KEY || process.env.JEV);
export const anthropicKey = () => clean(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE || process.env.CLAUDE_API_KEY);
export const aiGatewayKey = () => clean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_AI_GATEWAY_API_KEY);
