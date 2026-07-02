import { createServerFn } from "@tanstack/react-start";
import { exec } from "child_process";
import { writeFile, unlink, readdir, mkdir, rm, readFile } from "fs/promises";
import { join } from "path";
import { randomBytes } from "crypto";
import { tmpdir } from "os";
import { promisify } from "util";
import fs from "fs";

const execAsync = promisify(exec);

// Helper to find Rscript and Python in common Windows locations if not in PATH
async function findCommand(command: string): Promise<string> {
  if (process.platform !== "win32") return command;

  if (command === "Rscript") {
    try {
      const rPath = "C:\\Program Files\\R";
      if (fs.existsSync(rPath)) {
        const dirs = await readdir(rPath);
        const rDirs = dirs
          .filter((d) => d.startsWith("R-"))
          .sort()
          .reverse();
        if (rDirs.length > 0) {
          const exePath = join(rPath, rDirs[0], "bin", "Rscript.exe");
          if (fs.existsSync(exePath)) return `"${exePath}"`;
        }
      }
    } catch {
      // ignore
    }
  }

  if (command === "python") {
    try {
      const pyPath = "C:\\Program Files\\Python";
      // This is a basic fallback, but user should ideally add to PATH
      if (fs.existsSync(pyPath)) {
        return `"${join(pyPath, "python.exe")}"`;
      }
    } catch {
      // ignore
    }
  }

  return command;
}

interface ExecError extends Error {
  code?: number | string | null;
  killed?: boolean;
  stdout?: string;
  stderr?: string;
}

export type RunResult = {
  success: boolean;
  output: string;
  error?: string;
  images?: string[];
};

export const runCode = createServerFn({ method: "POST" })
  .validator(
    (input: { code: string; language: string; datasets?: { name: string; content: string }[] }) => {
      if (!input?.code) throw new Error("Code is required");
      if (!input?.language) throw new Error("Language is required");
      return input;
    },
  )
  .handler(async ({ data }): Promise<RunResult> => {
    const lang = data.language.toLowerCase();

    let command = "";
    let extension = "";

    if (lang.includes("python")) {
      command = "python";
      extension = ".py";
    } else if (lang.includes("r") && lang.length === 1) {
      command = "Rscript";
      extension = ".R";
    }

    if (!command) {
      return {
        success: false,
        output: "",
        error: `${data.language} cannot be compiled and run outside of its native environment (e.g., Power BI).`,
      };
    }

    const sessionId = randomBytes(4).toString("hex");
    const executionDir = join(tmpdir(), `codemorph_${sessionId}`);
    const fileName = `main${extension}`;
    const filePath = join(executionDir, fileName);

    const executable = await findCommand(command);

    try {
      await mkdir(executionDir, { recursive: true });

      let codeToRun = data.code;
      if (lang.includes("python")) {
        codeToRun = `try: import matplotlib as _m; _m.use('Agg'); import matplotlib.pyplot as _plt; _plt.show = lambda *a, **k: _plt.savefig('__auto_plot.png')\nexcept: pass\n` + codeToRun;
      } else if (lang.includes("r") && lang.length === 1) {
        codeToRun = `options(device = "png", warn = -1)\n` + codeToRun;
      }

      await writeFile(filePath, codeToRun, "utf-8");

      if (data.datasets && data.datasets.length > 0) {
        for (const dataset of data.datasets) {
          // If the content is base64 encoded, decode it, otherwise write as utf-8
          const isBase64 = dataset.content.startsWith("data:");
          if (isBase64) {
            const base64Data = dataset.content.split(",")[1];
            await writeFile(join(executionDir, dataset.name), Buffer.from(base64Data, "base64"));
          } else {
            await writeFile(join(executionDir, dataset.name), dataset.content, "utf-8");
          }
        }
      }

      // Execute the code locally within the execution directory
      const { stdout, stderr } = await execAsync(`${executable} "${fileName}"`, {
        cwd: executionDir,
        timeout: 30000,
      });

      const images: string[] = [];
      try {
        const files = await readdir(executionDir);
        for (const file of files) {
          if (file.toLowerCase().match(/\.(png|jpg|jpeg|gif|svg)$/)) {
            const ext = file.split(".").pop()?.toLowerCase();
            const mimeType =
              ext === "svg" ? "image/svg+xml" : `image/${ext === "jpg" ? "jpeg" : ext}`;
            const imgBuffer = await readFile(join(executionDir, file));
            images.push(`data:${mimeType};base64,${imgBuffer.toString("base64")}`);
          }
        }
      } catch (err) {
        console.error("Error reading output images:", err);
      }

      await rm(executionDir, { recursive: true, force: true }).catch(() => {});

      return {
        success: true,
        output: stdout + (stderr ? "\n" + stderr : ""),
        images,
      };
    } catch (e: unknown) {
      const error = e as ExecError;
      await rm(executionDir, { recursive: true, force: true }).catch(() => {});

      // If the command is not found, give a helpful error
      if (
        error.code === 127 ||
        error.message.includes("is not recognized") ||
        error.message.includes("ENOENT")
      ) {
        return {
          success: false,
          output: "",
          error: `Execution failed: The '${command}' command was not found on your system. Please ensure ${data.language} is installed and added to your system PATH.`,
        };
      }

      if (error.killed) {
        return {
          success: false,
          output: error.stdout || "",
          error: `Execution timed out after 30 seconds. Your code might have an infinite loop or be waiting for input. Note: plt.show() hangs the server, use plt.savefig() instead.`,
        };
      }

      const finalError = error.stderr || error.message || "Failed to execute code.";
      const finalStdoutError = error.stdout || "";

      return {
        success: false,
        output: finalStdoutError,
        error: finalError,
      };
    }
  });
