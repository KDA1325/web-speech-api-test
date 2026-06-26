/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_COMMAND_API_URL?: string;
  readonly VITE_ALLOW_BROWSER_LLM_DIRECT?: string;
  readonly VITE_OPENAI_API_KEY?: string;
  readonly VITE_OPENAI_MODEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
