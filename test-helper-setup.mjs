import { register } from "node:module";
import { pathToFileURL } from "node:url";
register("./test-helper.mjs", pathToFileURL("./").href);
