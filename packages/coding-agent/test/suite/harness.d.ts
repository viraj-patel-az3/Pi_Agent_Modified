/**
 * Local test harness for the new coding-agent test suite.
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { FauxModelDefinition, FauxProviderRegistration, FauxResponseStep, Model } from "@earendil-works/pi-ai";
import { AgentSession, type AgentSessionEvent } from "../../src/core/agent-session.ts";
import { AuthStorage } from "../../src/core/auth-storage.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import type { Settings } from "../../src/core/settings-manager.ts";
import { SettingsManager } from "../../src/core/settings-manager.ts";
import type { ExtensionFactory, ResourceLoader } from "../../src/index.ts";
import { type CreateTestExtensionsResultInput } from "../utilities.ts";
export declare function getMessageText(message: unknown): string;
export declare function getUserTexts(harness: Harness): string[];
export declare function getAssistantTexts(harness: Harness): string[];
export interface HarnessOptions {
    models?: FauxModelDefinition[];
    settings?: Partial<Settings>;
    systemPrompt?: string;
    tools?: AgentTool[];
    initialActiveToolNames?: string[];
    allowedToolNames?: string[];
    excludedToolNames?: string[];
    resourceLoader?: ResourceLoader;
    extensionFactories?: Array<ExtensionFactory | CreateTestExtensionsResultInput>;
    withConfiguredAuth?: boolean;
}
export interface Harness {
    session: AgentSession;
    sessionManager: SessionManager;
    settingsManager: SettingsManager;
    authStorage: AuthStorage;
    faux: FauxProviderRegistration;
    models: [Model<string>, ...Model<string>[]];
    getModel(): Model<string>;
    getModel(modelId: string): Model<string> | undefined;
    setResponses: (responses: FauxResponseStep[]) => void;
    appendResponses: (responses: FauxResponseStep[]) => void;
    getPendingResponseCount: () => number;
    events: AgentSessionEvent[];
    eventsOfType<T extends AgentSessionEvent["type"]>(type: T): Extract<AgentSessionEvent, {
        type: T;
    }>[];
    tempDir: string;
    cleanup: () => void;
}
export declare function createHarness(options?: HarnessOptions): Promise<Harness>;
//# sourceMappingURL=harness.d.ts.map