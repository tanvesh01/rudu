import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./app/App.js";

const renderer = await createCliRenderer();
createRoot(renderer).render(<App />);
