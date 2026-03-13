import { register } from "node:module";
import { pathToFileURL } from "node:url";

// Register custom loader
register("./test-helper-loader.mjs", pathToFileURL("./"));
