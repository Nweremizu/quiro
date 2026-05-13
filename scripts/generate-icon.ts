import fs from "fs";
import path from "path";

import * as Icons from "@hugeicons/core-free-icons";

const OUTPUT_PATH = path.resolve(
  import.meta.dirname,
  "../src/components/icons/generated.ts",
);

console.log(OUTPUT_PATH);
const iconEntries = Object.entries(Icons).filter(([name]) =>
  name.endsWith("Icon"),
);

const imports = iconEntries
  .map(([name]) => `${name} as _${name}`)
  .join(",\n  ");

const exportsCode = iconEntries
  .map(([name]) => {
    const exportName = name;

    return `export const ${exportName} = createIcon(_${name});`;
  })
  .join("\n\n");

const fileContent = `/* AUTO-GENERATED FILE */
/* DO NOT EDIT MANUALLY */

import {
  ${imports}
} from "@hugeicons/core-free-icons";

import { createIcon } from "../ui/create-icon";

${exportsCode}
`;

fs.writeFileSync(OUTPUT_PATH, fileContent);

console.log(`Generated ${iconEntries.length} wrapped icons`);
