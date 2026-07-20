/**
 * Shared test utilities for coding-agent tests.
 */
import { AgentSession } from "../src/core/agent-session.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import type { ExtensionFactory, LoadExtensionsResult } from "../src/core/extensions/index.ts";
import type { ResourceLoader } from "../src/core/resource-loader.ts";
import { SessionManager } from "../src/core/session-manager.ts";
/**
 * API key for authenticated tests. Tests using this should be wrapped in
 * describe.skipIf(!API_KEY)
 */
export declare const API_KEY: string | undefined;
/**
 * Resolve API key for a provider from ~/.pi/agent/auth.json
 *
 * For API key credentials, returns the key directly.
 * For OAuth credentials, returns the access token (refreshing if expired and saving back).
 *
 */
export declare function resolveApiKey(provider: string): Promise<string | undefined>;
/**
 * Check if a provider has credentials in ~/.pi/agent/auth.json
 */
export declare function hasAuthForProvider(provider: string): boolean;
/** Path to the real pi agent config directory */
export declare const PI_AGENT_DIR: string;
/**
 * Get an AuthStorage instance backed by ~/.pi/agent/auth.json
 * Use this for tests that need real OAuth credentials.
 */
export declare function getRealAuthStorage(): AuthStorage;
/**
 * Create a minimal user message for testing.
 */
export declare function userMsg(text: string): {
    role: "user";
    content: string;
    timestamp: number;
};
/**
 * Create a minimal assistant message for testing.
 */
export declare function assistantMsg(text: string): {
    role: "assistant";
    content: {
        type: "text";
        text: string;
    }[];
    api: "anthropic-messages";
    provider: string;
    model: string;
    usage: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
        totalTokens: number;
        cost: {
            input: number;
            output: number;
            cacheRead: number;
            cacheWrite: number;
            total: number;
        };
    };
    stopReason: "stop";
    timestamp: number;
};
/**
 * Options for creating a test session.
 */
export interface TestSessionOptions {
    /** Use in-memory session (no file persistence) */
    inMemory?: boolean;
    /** Custom system prompt */
    systemPrompt?: string;
    /** Custom settings overrides */
    settingsOverrides?: Record<string, unknown>;
}
/**
 * Resources returned by createTestSession that need cleanup.
 */
export interface TestSessionContext {
    session: AgentSession;
    sessionManager: SessionManager;
    tempDir: string;
    cleanup: () => void;
}
export interface CreateTestExtensionsResultInput {
    factory: ExtensionFactory;
    path?: string;
}
export declare function createTestExtensionsResult(inputs: Array<ExtensionFactory | CreateTestExtensionsResultInput>, cwd?: string): Promise<LoadExtensionsResult>;
export interface CreateTestResourceLoaderOptions {
    extensionsResult?: LoadExtensionsResult;
}
export declare function createTestResourceLoader(options?: CreateTestResourceLoaderOptions): ResourceLoader;
/**
 * Create an AgentSession for testing with proper setup and cleanup.
 * Use this for e2e tests that need real LLM calls.
 */
export declare function createTestSession(options?: TestSessionOptions): TestSessionContext;
/**
 * Build a session tree for testing using SessionManager.
 * Returns the IDs of all created entries.
 *
 * Example tree structure:
 * ```
 * u1 -> a1 -> u2 -> a2
 *          -> u3 -> a3  (branch from a1)
 * u4 -> a4              (another root)
 * ```
 */
export declare function buildTestTree(session: SessionManager, structure: {
    messages: Array<{
        role: "user" | "assistant";
        text: string;
        branchFrom?: string;
    }>;
}): Map<string, string>;
//# sourceMappingURL=utilities.d.ts.map