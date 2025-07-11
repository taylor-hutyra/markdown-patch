#!/usr/bin/env node
import { Command } from "commander";
import fs from "fs/promises";
import { getDocumentMap } from "./map.js";
import { printMap } from "./debug.js";
import { PatchInstruction, PatchOperation, PatchTargetType } from "./types.js";
import { applyPatch } from "./patch.js";
import packageJson from "../package.json";

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

const program = new Command();

// Configure the CLI
program
  .name(Object.keys(packageJson.bin)[0])
  .description(packageJson.description)
  .version(packageJson.version);

program
  .command("print-map")
  .argument("<path>", "filepath to show identified patchable paths for")
  .argument(
    "[regex]",
    "limit displayed matches to those matching the supplied regular expression"
  )
  .action(async (path: string, regex: string | undefined) => {
    const document = await fs.readFile(path, "utf-8");
    const documentMap = getDocumentMap(document);

    printMap(document, documentMap, regex ? new RegExp(regex) : undefined);
  });

program
  .command("patch")
  .option(
    "-i, --input <input>",
    "Path to content to insert; by default reads from stdin."
  )
  .option(
    "-o, --output <output>",
    "Path to write output to; use '-' for stdout.  Defaults to patching in-place."
  )
  .option(
    "-d, --delimiter <delimiter>",
    "Heading delimiter to use in place of '::'.",
    "::"
  )
  .option(
    "--replace-heading",
    "Replace the heading as well as its content."
  )
  .argument("<operation>", "Operation to perform ('replace', 'append', etc.)")
  .argument("<targetType>", "Target type ('heading', 'block', etc.)")
  .argument(
    "<target>",
    "Target ('::'-delimited by default for Headings); see `mdpatch print-map <path to document>` for options)"
  )
  .argument("<documentPath>", "Path to document to apply patch to.")
  .action(
    async (
      operation: PatchOperation,
      targetType: PatchTargetType,
      target: string,
      documentPath: string,
      options
    ) => {
      let content: string;
      if (options.input) {
        content = await fs.readFile(options.input, "utf-8");
      } else {
        content = await readStdin();
      }

      const document = await fs.readFile(documentPath, "utf-8");

      let instruction: PatchInstruction;

      // Only create a ReplaceHeadingPatchInstruction when the operation and target are correct
      if (operation === "replace" && targetType === "heading") {
        instruction = {
          operation,
          targetType,
          content,
          target: target.split(options.delimiter),
          replaceHeading: options.replaceHeading, 
        };
      } else {
        // If the user tries to use the flag incorrectly, exit with an error.
        if (options.replaceHeading) {
          console.error(
            "The --replace-heading flag is only valid for 'replace' operations on 'heading' targets."
          );
          process.exit(1);
        }
        // Create other instruction types as before
        instruction = {
          operation,
          targetType,
          content,
          target:
            targetType !== "heading" ? target : target.split(options.delimiter),
        } as PatchInstruction;
      }

      const patchedDocument = applyPatch(document, instruction);
      if (options.output === "-") {
        process.stdout.write(patchedDocument);
      } else {
        await fs.writeFile(
          options.output ? options.output : documentPath,
          patchedDocument
        );
      }
    }
  );

program
  .command("apply")
  .argument("<path>", "file to patch")
  .argument("<patch>", "patch file to apply")
  .option(
    "-o, --output <output>",
    "write output to the specified path instead of applying in-place; use '-' for stdout"
  )
  .action(async (path: string, patch: string, options) => {
    let patchParsed: PatchInstruction[];
    let patchData: string;
    try {
      if (patch === "-") {
        patchData = await readStdin();
      } else {
        patchData = await fs.readFile(patch, "utf-8");
      }
    } catch (e) {
      console.error("Failed to read patch: ", e);
      process.exit(1);
    }

    try {
      const parsedData = JSON.parse(patchData);
      if (!Array.isArray(parsedData)) {
        patchParsed = [parsedData];
      } else {
        patchParsed = parsedData;
      }
    } catch (e) {
      console.error("Could not parse patch file as JSON");
      process.exit(1);
    }

    let document = await fs.readFile(path, "utf-8");
    console.log("Document", document);
    for (const instruction of patchParsed) {
      document = applyPatch(document, instruction);
    }

    if (options.output === "-") {
      process.stdout.write(document);
    } else {
      await fs.writeFile(options.output ? options.output : path, document);
    }
  });

program
  .command("query")
  .option(
    "-o, --output <output>",
    "Path to write output to; use '-' for stdout.  Defaults to patching in-place."
  )
  .option(
    "-d, --delimiter <delimiter>",
    "Heading delimiter to use in place of '::'.",
    "::"
  )
  .argument("<targetType>", "Target type ('heading', 'block', etc.)")
  .argument(
    "<target>",
    "Target ('::'-delimited by default for Headings); see `mdpatch print-map <path to document>` for options)"
  )
  .argument("<documentPath>", "Path to document to query from.")
  .action(
    async (
      targetType: PatchTargetType,
      target: string,
      documentPath: string,
      options
    ) => {
      const document = await fs.readFile(documentPath, "utf-8");
      const documentMap = getDocumentMap(document);
      const actualTarget =
        targetType !== "heading"
          ? target
          : target.split(options.delimiter).join("\u001f");

      const value = document.slice(
        documentMap[targetType][actualTarget].content.start,
        documentMap[targetType][actualTarget].content.end
      );

      if (options.output) {
        await fs.writeFile(options.output, value);
      } else {
        process.stdout.write(value);
      }
    }
  );

program.parse(process.argv);
