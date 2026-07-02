import { createServerFn } from "@tanstack/react-start";

const MODEL = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";
const ENDPOINT = `https://api.groq.com/openai/v1/chat/completions`;

type GroqResponse = {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function detectLanguage(code: string): AnalysisResult["language"] {
  const content = stripComments(code).trim();
  if (!content) return "Unknown";

  const scores = {
    Python: 0,
    R: 0,
    DAX: 0,
    M: 0,
  };

  if (
    /\b(?:CALCULATE|FILTER|EVALUATE|SUMX|VALUES|TOPN|SUMMARIZE|SELECTCOLUMNS|VAR|RETURN)\b/i.test(
      content,
    )
  ) {
    scores.DAX += 4;
  }
  if (/\b[A-Za-z_][\w]*\[[^\]]+\]/.test(content)) scores.DAX += 2;
  if (/\b[A-Za-z_][\w]*\s*:=/m.test(content)) scores.DAX += 2;

  if (/^\s*let\b[\s\S]*\bin\b/im.test(content)) scores.M += 4;
  if (/\b(?:Table|List|Text|Date|Number|Csv|Excel|Json|Binary)\.[A-Za-z]+\(/.test(content))
    scores.M += 3;
  if (/#"[^"]+"/.test(content)) scores.M += 2;
  if (/\bSource\s*=\s*/i.test(content)) scores.M += 1;

  if (/\b(?:library|require)\s*\(/i.test(content)) scores.R += 3;
  if (
    /\b(?:read\.csv|group_by|summarise|summarize|arrange|mutate|select|ggplot|dplyr)\b/i.test(
      content,
    )
  )
    scores.R += 3;
  if (/%>%/.test(content)) scores.R += 3;
  if (/<-|->/.test(content)) scores.R += 4;

  if (/\b(?:import|from|def|class|with|lambda|elif|yield)\b/.test(content)) scores.Python += 4;
  if (/\b(?:pd\.read_csv|read_csv|groupby\(|sort_values\(|head\(|agg\()/.test(content))
    scores.Python += 3;
  if (/\bprint\(/.test(content)) {
    scores.Python += 3;
    scores.R += 1;
  }
  if (/\bif __name__\s*==\s*['"]__main__['"]/i.test(content)) scores.Python += 3;

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [bestLanguage, bestScore] = ranked[0] ?? ["Unknown", 0];
  const secondBest = ranked[1]?.[1] ?? 0;

  if (bestScore < 3 || (bestScore === secondBest && bestScore < 5)) return "Unknown";
  if (bestLanguage === "DAX") return "Power BI (DAX)";
  if (bestLanguage === "M") return "Power Query (M)";
  if (bestLanguage === "R") return "R";
  if (bestLanguage === "Python") return "Python";
  return "Unknown";
}

function stripComments(code: string): string {
  return code
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(#|\/\/|--).*/, ""))
    .join("\n");
}

function buildOfflineAnalysis(code: string, reason: string): AnalysisResult {
  const language = detectLanguage(code);
  const supported = language !== "Unknown";

  return {
    supported,
    language,
    confidence: supported ? 72 : 12,
    status: supported ? "Valid" : "Error Detected",
    errors: supported
      ? []
      : [
          {
            description: reason,
            suggestedFix:
              "Check the Groq API key, model access, billing, or quota settings, then try again.",
          },
        ],
    summary: supported
      ? `Offline detection identified this as ${language} code.`
      : "Groq is unavailable, so the code could not be analyzed.",
  };
}

function buildOfflineConversion(
  code: string,
  sourceLanguage: string,
  targetLanguage: string,
  reason: string,
): ConversionResult {
  console.error("Groq conversion failed:", reason);
  const convertedCode = convertOfflineCode(code, sourceLanguage, targetLanguage);

  return {
    convertedCode,
    explanation: {
      summary: `Groq is unavailable, so a local fallback converter translated ${sourceLanguage} into ${targetLanguage}.`,
      mappings: buildOfflineMappings(sourceLanguage, targetLanguage),
      notes: [
        "Using the local fallback converter because Groq is unavailable.",
        "Enable Groq billing/quota access to get real conversions.",
      ],
    },
  };
}

function buildOfflineMappings(sourceLanguage: string, targetLanguage: string) {
  if (sourceLanguage === "R" && targetLanguage === "Python") {
    return [
      { from: "library(dplyr)", to: "import pandas as pd" },
      { from: "read.csv()", to: "pd.read_csv()" },
      { from: "%>%", to: "pandas method chaining" },
      { from: "group_by()", to: "groupby()" },
      { from: "summarise()", to: "agg()" },
      { from: "arrange(desc())", to: "sort_values(ascending=False)" },
      { from: "head(n)", to: "head(n)" },
    ];
  }

  if (sourceLanguage === "R" && targetLanguage === "Power BI (DAX)") {
    return [
      { from: "library(dplyr)", to: "DAX calculated table / measure" },
      { from: "read.csv()", to: "model table import" },
      { from: "%>%", to: "nested DAX expressions" },
      { from: "group_by()", to: "SUMMARIZE()" },
      { from: "summarise()", to: "SUMMARIZE() + aggregation" },
      { from: "arrange(desc())", to: "TOPN() / ORDER BY DESC" },
      { from: "head(n)", to: "TOPN(n, ...)" },
    ];
  }

  if (sourceLanguage === "R" && targetLanguage === "Power Query (M)") {
    return [
      { from: "library(dplyr)", to: "Power Query M functions" },
      { from: "read.csv()", to: "Csv.Document()" },
      { from: "%>%", to: "M pipeline (let...in)" },
      { from: "group_by()", to: "Table.Group()" },
      { from: "summarise()", to: "Table.Group() aggregation" },
      { from: "arrange(desc())", to: "Table.Sort() descending" },
      { from: "head(n)", to: "Table.FirstN()" },
    ];
  }

  if (sourceLanguage === "Python" && targetLanguage === "R") {
    return [
      { from: "import pandas as pd", to: "library(dplyr)" },
      { from: "pd.read_csv()", to: "read.csv()" },
      { from: "groupby()", to: "group_by()" },
      { from: "agg()", to: "summarise()" },
      { from: "sort_values()", to: "arrange()" },
    ];
  }

  if (sourceLanguage === "Python" && targetLanguage === "Power Query (M)") {
    return [
      { from: "import pandas as pd", to: "Power Query M load" },
      { from: "pd.read_csv()", to: "Csv.Document()" },
      { from: "groupby()", to: "Table.Group()" },
      { from: "agg()", to: "aggregation function" },
      { from: "sort_values()", to: "Table.Sort()" },
      { from: "head(n)", to: "Table.FirstN()" },
    ];
  }

  if (sourceLanguage.includes("DAX") && targetLanguage === "Python") {
    return [
      { from: "CALCULATE", to: "pandas filtering / aggregation" },
      { from: "SUM", to: "sum()" },
      { from: "VALUES", to: "unique values" },
      { from: "TOPN", to: "sort_values().head()" },
    ];
  }

  if (sourceLanguage.includes("DAX") && targetLanguage === "R") {
    return [
      { from: "CALCULATE", to: "dplyr filtering / summarise" },
      { from: "SUM", to: "sum()" },
      { from: "VALUES", to: "distinct()" },
      { from: "TOPN", to: "arrange() + head()" },
    ];
  }

  if (sourceLanguage.includes("DAX") && targetLanguage === "Power Query (M)") {
    return [
      { from: "CALCULATE", to: "Table.AddColumn() / let" },
      { from: "SUMMARIZE", to: "Table.Group()" },
      { from: "TOPN", to: "Table.FirstN() + Table.Sort()" },
      { from: "SUM", to: "Number.Sum" },
      { from: "FILTER", to: "Table.SelectRows()" },
    ];
  }

  if (sourceLanguage === "Power Query (M)" && targetLanguage === "Python") {
    return [
      { from: "Csv.Document()", to: "pd.read_csv()" },
      { from: "Table.Group()", to: "groupby()" },
      { from: "Table.Sort()", to: "sort_values()" },
      { from: "Table.FirstN()", to: "head()" },
      { from: "let...in", to: "pandas pipeline" },
    ];
  }

  if (sourceLanguage === "Power Query (M)" && targetLanguage === "R") {
    return [
      { from: "Csv.Document()", to: "read.csv()" },
      { from: "Table.Group()", to: "group_by()" },
      { from: "Table.Sort()", to: "arrange()" },
      { from: "Table.FirstN()", to: "head()" },
      { from: "let...in", to: "%>% pipeline" },
    ];
  }

  if (sourceLanguage === "Power Query (M)" && targetLanguage.includes("DAX")) {
    return [
      { from: "Table.Group()", to: "SUMMARIZE()" },
      { from: "Table.Sort()", to: "TOPN() / ORDER BY" },
      { from: "Table.FirstN()", to: "TOPN()" },
      { from: "Number.Sum", to: "SUM" },
      { from: "Table.SelectRows()", to: "FILTER" },
    ];
  }

  return [];
}

function convertOfflineCode(code: string, sourceLanguage: string, targetLanguage: string): string {
  const normalizedSource = sourceLanguage.toLowerCase();
  const normalizedTarget = targetLanguage.toLowerCase();

  if (normalizedSource === "r" && normalizedTarget === "python") {
    return convertRToPython(code);
  }

  if (normalizedSource === "python" && normalizedTarget.includes("dax")) {
    return convertPythonToDax(code);
  }

  if (normalizedSource === "python" && normalizedTarget === "r") {
    return convertPythonToR(code);
  }

  if (normalizedSource === "r" && normalizedTarget.includes("dax")) {
    return convertRToDax(code);
  }

  if (normalizedSource.includes("dax") && normalizedTarget === "python") {
    return convertDaxToPython(code);
  }

  if (normalizedSource.includes("dax") && normalizedTarget === "r") {
    return convertDaxToR(code);
  }

  if (normalizedSource.includes("m") && normalizedTarget === "python") {
    return convertMToPython(code);
  }

  if (normalizedSource.includes("m") && normalizedTarget === "r") {
    return convertMToR(code);
  }

  if (normalizedSource.includes("m") && normalizedTarget.includes("dax")) {
    return convertMToDax(code);
  }

  if (normalizedSource === "python" && normalizedTarget.includes("m")) {
    return convertPythonToM(code);
  }

  if (normalizedSource === "r" && normalizedTarget.includes("m")) {
    return convertRToM(code);
  }

  if (normalizedSource.includes("dax") && normalizedTarget.includes("m")) {
    return convertDaxToM(code);
  }

  return code;
}

function convertRToPython(code: string): string {
  const pattern = parseRPattern(code);
  if (pattern) {
    return [
      "import pandas as pd",
      "",
      `${pattern.dataFrameName} = pd.read_csv(${pattern.fileLiteral})`,
      `${pattern.resultName} = (`,
      `    ${pattern.dataFrameName}.groupby(${pythonGroupColumns(pattern.groupColumns)})[${pythonValueColumn(pattern.valueColumn)}]`,
      `    .${pattern.aggregation}()`,
      `    .sort_values(ascending=False)`,
      `    .head(${pattern.topN})`,
      `)`,
      `print(${pattern.resultName})`,
    ].join("\n");
  }

  // Fallback: convert R syntax to Python
  return (
    code
      .replace(/library\(dplyr\)/gi, "import pandas as pd")
      .replace(/read\.csv\(/gi, "pd.read_csv(")
      .replace(/<-/g, "=")
      .replace(/%>%/g, ".")
      .replace(/group_by\(([^)]+)\)/gi, "groupby([$1])")
      .replace(/summarise\(([^)]+)\)/gi, "agg($1)")
      .replace(/arrange\(desc\(([^)]+)\)\)/gi, 'sort_values(ascending=False, by="$1")')
      .trim() || "# Converted from R"
  );
}

function convertRPipelineToPython(code: string): string {
  const pattern = parseRPattern(code);
  if (!pattern) return "";

  return [
    "import pandas as pd",
    "",
    `${pattern.dataFrameName} = pd.read_csv(${pattern.fileLiteral})`,
    `${pattern.resultName} = (`,
    `    ${pattern.dataFrameName}.groupby(${pythonGroupColumns(pattern.groupColumns)})[${pythonValueColumn(pattern.valueColumn)}]`,
    `    .${pattern.aggregation}()`,
    `    .sort_values(ascending=False)`,
    `    .head(${pattern.topN})`,
    `)`,
    `print(${pattern.resultName})`,
  ].join("\n");
}

function convertPythonToR(code: string): string {
  const pattern = parsePythonPattern(code);
  if (pattern) {
    return [
      "library(dplyr)",
      "",
      `${pattern.dataFrameName} <- read.csv(${pattern.fileLiteral})`,
      `${pattern.resultName} <- ${pattern.dataFrameName} %>%`,
      `  group_by(${pattern.groupColumns.join(", ")}) %>%`,
      `  summarise(total = ${pattern.aggregation}( ${pattern.valueColumn} )) %>%`,
      `  arrange(desc(total)) %>%`,
      `  head(${pattern.topN})`,
      `print(${pattern.resultName})`,
    ].join("\n");
  }

  // Fallback: convert Python syntax to R
  return (
    code
      .replace(/import pandas as pd/g, "library(dplyr)")
      .replace(/([A-Za-z_][\w.]*)\s*=\s*pd\.read_csv\((.+)\)/g, "$1 <- read.csv($2)")
      .replace(/\.groupby\(\[(.+?)\]\)/g, " %>% group_by($1)")
      .replace(/\.sort_values\(by="(.+?)",\s*ascending=False\)/g, " %>% arrange(desc($1))")
      .replace(/\.head\((\d+)\)/g, " %>% head($1)")
      .replace(/print\(/g, "print(")
      .trim() || "# Converted from Python"
  );
}

function convertPythonToDax(code: string): string {
  const pattern = parsePythonPattern(code);
  if (pattern) {
    const tableName = toDaxTableName(pattern.dataFrameName, pattern.fileName);
    const resultName = inferAssignmentName(code) ?? "TopSalesByRegion";

    return [
      `${resultName} =`,
      `TOPN (`,
      `    ${pattern.topN},`,
      `    SUMMARIZE (`,
      `        ${tableName},`,
      `        ${tableName}[${pattern.groupColumn}],`,
      `        "total", ${daxAggregation(pattern.aggregation)} ( ${tableName}[${pattern.valueColumn}] )`,
      `    ),`,
      `    [total], DESC`,
      `)`,
    ].join("\n");
  }

  // Fallback: convert basic Python syntax to DAX comments + basic structure
  const resultName = inferAssignmentName(code) ?? "Result";
  return (
    code
      .split("\n")
      .map((line) => {
        if (line.includes("=") && !line.includes("==")) {
          // Variable assignment
          const match = line.match(/(\w+)\s*=\s*(.+)/);
          if (match) {
            return `// ${match[1]} = ${match[2]}`;
          }
        }
        if (line.includes("print")) {
          return `// Output: ${line}`;
        }
        return `// ${line}`;
      })
      .join("\n")
      .trim() || `// Converted from Python\n// ${resultName}`
  );
}

function convertDaxToPython(code: string): string {
  const pattern = parseDaxPattern(code);
  if (pattern) {
    return [
      "import pandas as pd",
      "",
      `# DAX source table: ${pattern.tableName}`,
      `${pattern.dataFrameName} = pd.read_csv(${pattern.fileLiteral})`,
      `${pattern.resultName} = (`,
      `    ${pattern.dataFrameName}.groupby(${pythonGroupColumns([pattern.groupColumn])})[${pythonValueColumn(pattern.valueColumn)}]`,
      `    .${pattern.aggregation}()`,
      `    .sort_values(ascending=False)`,
      `    .head(${pattern.topN})`,
      `)`,
      `print(${pattern.resultName})`,
    ].join("\n");
  }

  // Fallback: convert DAX syntax to Python comments
  return (
    code
      .split("\n")
      .map((line) => `# ${line}`)
      .join("\n")
      .trim() || "# Converted from DAX"
  );
}

function convertDaxToR(code: string): string {
  const pattern = parseDaxPattern(code);
  if (pattern) {
    return [
      "library(dplyr)",
      "",
      `# DAX source table: ${pattern.tableName}`,
      `${pattern.dataFrameName} <- read.csv("${pattern.tableName}.csv")`,
      `${pattern.resultName} <- ${pattern.dataFrameName} %>%`,
      `  group_by(${pattern.groupColumn}) %>%`,
      `  summarise(total = ${pattern.aggregation}( ${pattern.valueColumn} )) %>%`,
      `  arrange(desc(total)) %>%`,
      `  head(${pattern.topN})`,
      `print(${pattern.resultName})`,
    ].join("\n");
  }

  // Fallback: convert DAX syntax to R comments
  return (
    code
      .split("\n")
      .map((line) => `# ${line}`)
      .join("\n")
      .trim() || "# Converted from DAX"
  );
}

function convertRToDax(code: string): string {
  const pattern = parseRPattern(code);
  if (pattern) {
    const tableName = toDaxTableName(pattern.dataFrameName, pattern.fileName);
    return [
      `${pattern.resultName} =`,
      `TOPN (`,
      `    ${pattern.topN},`,
      `    SUMMARIZE (`,
      `        ${tableName},`,
      `        ${tableName}[${pattern.groupColumns[0] ?? "region"}],`,
      `        "total", ${daxAggregation(pattern.aggregation)} ( ${tableName}[${pattern.valueColumn}] )`,
      `    ),`,
      `    [total], DESC`,
      `)`,
    ].join("\n");
  }

  // Fallback: basic R to DAX conversion
  const tableName = inferTableNameFromCode(code);
  const resultName = inferAssignmentName(code) ?? "Result";
  return (
    code
      .split("\n")
      .map((line) => {
        if (line.includes("<-")) {
          const match = line.match(/(\w+)\s*<-\s*(.+)/);
          if (match) {
            return `// ${match[1]} := ${match[2]}`;
          }
        }
        if (line.includes("print")) {
          return `// Output: ${line}`;
        }
        return `// ${line}`;
      })
      .join("\n")
      .trim() || `// Converted from R\n// ${resultName}`
  );
}

function convertMToPython(code: string): string {
  const pattern = parseMPattern(code);
  if (pattern) {
    return [
      "import pandas as pd",
      "",
      `# Power Query source: ${pattern.tableName}`,
      `${pattern.dataFrameName} = pd.read_csv(${pattern.fileLiteral})`,
      `${pattern.resultName} = (`,
      `    ${pattern.dataFrameName}.groupby(${pythonGroupColumns([pattern.groupColumn])})[${pythonValueColumn(pattern.valueColumn)}]`,
      `    .${pattern.aggregation}()`,
      `    .sort_values(ascending=False)`,
      `    .head(${pattern.topN})`,
      `)`,
      `print(${pattern.resultName})`,
    ].join("\n");
  }

  // Fallback: convert M syntax to Python comments
  return (
    code
      .split("\n")
      .map((line) => `# ${line}`)
      .join("\n")
      .replace(/#\s*let\b/g, "# Power Query let block:")
      .replace(/#\s*in\b/g, "# Result:")
      .trim() || "# Converted from Power Query M"
  );
}

function convertMToR(code: string): string {
  const pattern = parseMPattern(code);
  if (pattern) {
    return [
      "library(dplyr)",
      "",
      `# Power Query source: ${pattern.tableName}`,
      `${pattern.dataFrameName} <- read.csv("${pattern.tableName}.csv")`,
      `${pattern.resultName} <- ${pattern.dataFrameName} %>%`,
      `  group_by(${pattern.groupColumn}) %>%`,
      `  summarise(total = ${pattern.aggregation}( ${pattern.valueColumn} )) %>%`,
      `  arrange(desc(total)) %>%`,
      `  head(${pattern.topN})`,
      `print(${pattern.resultName})`,
    ].join("\n");
  }

  // Fallback: convert M syntax to R comments
  return (
    code
      .split("\n")
      .map((line) => `# ${line}`)
      .join("\n")
      .replace(/#\s*let\b/g, "# Power Query let block:")
      .replace(/#\s*in\b/g, "# Result:")
      .trim() || "# Converted from Power Query M"
  );
}

function convertMToDax(code: string): string {
  const pattern = parseMPattern(code);
  if (pattern) {
    const tableName = toDaxTableName(pattern.dataFrameName, pattern.fileName);
    const resultName = inferAssignmentName(code) ?? "TopSalesByRegion";

    return [
      `${resultName} =`,
      `TOPN (`,
      `    ${pattern.topN},`,
      `    SUMMARIZE (`,
      `        ${tableName},`,
      `        ${tableName}[${pattern.groupColumn}],`,
      `        "total", ${daxAggregation(pattern.aggregation)} ( ${tableName}[${pattern.valueColumn}] )`,
      `    ),`,
      `    [total], DESC`,
      `)`,
    ].join("\n");
  }

  // Fallback: convert M syntax to DAX comments
  const resultName = "Result";
  return (
    code
      .split("\n")
      .map((line) => `// ${line}`)
      .join("\n")
      .replace(/\/\/\s*let\b/g, "// Power Query let block:")
      .replace(/\/\/\s*in\b/g, "// Result:")
      .trim() || `// Converted from Power Query M\n// ${resultName}`
  );
}

function convertPythonToM(code: string): string {
  const pattern = parsePythonPattern(code);
  if (pattern) {
    const tableName = toDaxTableName(pattern.dataFrameName, pattern.fileName);
    const resultName = inferAssignmentName(code) ?? "result";

    return [
      "let",
      `    Source = Csv.Document(File.Contents("${pattern.fileName}")),`,
      `    #"Promoted Headers" = Table.PromoteHeaders(Source),`,
      `    #"Grouped Rows" = Table.Group(#"Promoted Headers", {"${pattern.groupColumn}"}, {{"total", each List.Sum(List.Transform([${pattern.valueColumn}], each Number.FromText(_))), type number}}),`,
      `    #"Sorted Rows" = Table.Sort(#"Grouped Rows", {{"total", Order.Descending}}),`,
      `    #"Kept First Rows" = Table.FirstN(#"Sorted Rows", ${pattern.topN})`,
      `in`,
      `    #"Kept First Rows"`,
    ].join("\n");
  }

  // Fallback: convert Python syntax to Power Query comments
  return (
    code
      .split("\n")
      .map((line) => `// ${line}`)
      .join("\n")
      .trim() || "// Converted from Python"
  );
}

function convertRToM(code: string): string {
  const pattern = parseRPattern(code);
  if (pattern) {
    const tableName = toDaxTableName(pattern.dataFrameName, pattern.fileName);

    return [
      "let",
      `    Source = Csv.Document(File.Contents("${pattern.fileName}")),`,
      `    #"Promoted Headers" = Table.PromoteHeaders(Source),`,
      `    #"Grouped Rows" = Table.Group(#"Promoted Headers", {"${pattern.groupColumn}"}, {{"total", each List.Sum(List.Transform([${pattern.valueColumn}], each Number.FromText(_))), type number}}),`,
      `    #"Sorted Rows" = Table.Sort(#"Grouped Rows", {{"total", Order.Descending}}),`,
      `    #"Kept First Rows" = Table.FirstN(#"Sorted Rows", ${pattern.topN})`,
      `in`,
      `    #"Kept First Rows"`,
    ].join("\n");
  }

  // Fallback: convert R syntax to Power Query comments
  return (
    code
      .split("\n")
      .map((line) => `// ${line}`)
      .join("\n")
      .replace(/\/\/\s*library|read\.csv|group_by/g, (m) => m.replace(/^\/\/ /, "// R function: "))
      .trim() || "// Converted from R"
  );
}

function convertDaxToM(code: string): string {
  const pattern = parseDaxPattern(code);
  if (pattern) {
    return [
      "let",
      `    Source = Csv.Document(File.Contents("${pattern.tableName}.csv")),`,
      `    #"Promoted Headers" = Table.PromoteHeaders(Source),`,
      `    #"Grouped Rows" = Table.Group(#"Promoted Headers", {"${pattern.groupColumn}"}, {{"total", each List.Sum(List.Transform([${pattern.valueColumn}], each Number.FromText(_))), type number}}),`,
      `    #"Sorted Rows" = Table.Sort(#"Grouped Rows", {{"total", Order.Descending}}),`,
      `    #"Kept First Rows" = Table.FirstN(#"Sorted Rows", ${pattern.topN})`,
      `in`,
      `    #"Kept First Rows"`,
    ].join("\n");
  }

  // Fallback: convert DAX syntax to Power Query comments
  return (
    code
      .split("\n")
      .map((line) => `// ${line}`)
      .join("\n")
      .trim() || "// Converted from DAX"
  );
}

type ParsedPattern = {
  fileName: string;
  fileLiteral: string;
  dataFrameName: string;
  tableName?: string;
  resultName: string;
  groupColumns: string[];
  groupColumn: string;
  valueColumn: string;
  aggregation: "sum" | "mean" | "count";
  topN: number;
};

function parsePythonPattern(code: string): ParsedPattern | null {
  const fileMatch = code.match(/([A-Za-z_][\w]*)\s*=\s*pd\.read_csv\(([^)]+)\)/i);
  const groupMatch = code.match(/\.groupby\(([^)]+)\)/i);
  const valueMatch = code.match(/\[\s*['"]([^'"]+)['"]\s*\]\s*\.\s*(sum|mean|count)\s*\(/i);
  const topMatch = code.match(/\.head\((\d+)\)/i);
  if (!fileMatch || !groupMatch || !valueMatch) return null;

  const fileName = fileMatch[2].replace(/['"`]/g, "").split(/[\\/]/).pop() ?? "data.csv";
  const resultName = inferAssignmentName(code) ?? "top";
  const dataFrameName = fileMatch[1];
  const groupColumns = splitColumns(groupMatch[1]);
  return {
    fileName,
    fileLiteral: fileMatch[2].trim(),
    dataFrameName,
    resultName,
    groupColumns: groupColumns.length > 0 ? groupColumns : ["region"],
    groupColumn: groupColumns[0] ?? "region",
    valueColumn: valueMatch[1],
    aggregation: valueMatch[2].toLowerCase() as ParsedPattern["aggregation"],
    topN: topMatch ? Number(topMatch[1]) : 5,
  };
}

function parseRPattern(code: string): ParsedPattern | null {
  const fileMatch = code.match(/([A-Za-z_][\w]*)\s*<-\s*read\.csv\(([^)]+)\)/i);
  const groupMatch = code.match(/group_by\(([^)]+)\)/i);
  const valueMatch = code.match(/(?:summarise|summarize)\(([^)]+)\)/i);
  const topMatch = code.match(/head\((\d+)\)/i);
  if (!fileMatch || !groupMatch) return null;

  const fileName = fileMatch[2].replace(/['"`]/g, "").split(/[\\/]/).pop() ?? "data.csv";
  const resultName = inferAssignmentName(code) ?? "top";
  const dataFrameName = fileMatch[1];
  const groupColumns = splitColumns(groupMatch[1]);
  const summary = valueMatch?.[1] ?? "total = sum(amount)";
  const summaryValueMatch = summary.match(/(?:sum|mean|count)\(([^)]+)\)/i);
  const aggregationMatch = summary.match(/=\s*(sum|mean|count)\s*\(/i);

  return {
    fileName,
    fileLiteral: fileMatch[2].trim(),
    dataFrameName,
    resultName,
    groupColumns: groupColumns.length > 0 ? groupColumns : ["region"],
    groupColumn: groupColumns[0] ?? "region",
    valueColumn: summaryValueMatch?.[1].trim() ?? "amount",
    aggregation: (aggregationMatch?.[1].toLowerCase() as ParsedPattern["aggregation"]) ?? "sum",
    topN: topMatch ? Number(topMatch[1]) : 5,
  };
}

function parseDaxPattern(code: string): ParsedPattern | null {
  const tableMatch = code.match(
    /SUMMARIZE\s*\(\s*([A-Za-z_][\w]*)\s*,\s*\1\[([^\]]+)\].*?SUM\s*\(\s*\1\[([^\]]+)\]\s*\)/is,
  );
  const valuesMatch = code.match(/VALUES\s*\(\s*([A-Za-z_][\w]*)\[([^\]]+)\]\s*\)/i);
  const topMatch = code.match(/TOPN\s*\(\s*(\d+)/i);
  const resultMatch = code.match(/^\s*([A-Za-z_][\w]*)\s*:=/m);

  if (!tableMatch && !valuesMatch) return null;

  const tableName = tableMatch?.[1] ?? valuesMatch?.[1] ?? "Sales";
  const groupColumn = tableMatch?.[2] ?? valuesMatch?.[2] ?? "Region";
  const valueColumn = tableMatch?.[3] ?? "Amount";

  return {
    fileName: `${tableName}.csv`,
    fileLiteral: `"${tableName}.csv"`,
    dataFrameName: tableName.toLowerCase(),
    resultName: resultMatch?.[1] ?? "top",
    groupColumns: [groupColumn],
    groupColumn,
    valueColumn,
    aggregation: "sum",
    topN: topMatch ? Number(topMatch[1]) : 5,
  };
}

function parseMPattern(code: string): ParsedPattern | null {
  const sourceMatch =
    code.match(/Csv\.Document\(File\.Contents\(["']([^"']+)["']\)\)/i) ||
    code.match(/Source\s*=\s*Csv\.Document\(File\.Contents\(["']([^"']+)["']\)\)/i);
  const groupMatch = code.match(/Table\.Group\([^,]+,\s*\{["']([^"']+)["']\}/i);
  const valueMatch = code.match(/List\.Transform\(\[([^\]]+)\]/i);
  const topMatch = code.match(/Table\.FirstN\([^,]+,\s*(\d+)\)/i);

  if (!sourceMatch || !groupMatch) return null;

  const fileName = sourceMatch[1] ?? "data.csv";
  const groupColumn = groupMatch[1] ?? "region";
  const valueColumn = valueMatch?.[1] ?? "amount";
  const topN = topMatch ? Number(topMatch[1]) : 5;

  return {
    fileName,
    fileLiteral: `"${fileName}"`,
    dataFrameName: fileName.replace(/\.csv$/i, "").toLowerCase(),
    resultName: "result",
    groupColumns: [groupColumn],
    groupColumn,
    valueColumn,
    aggregation: "sum",
    topN,
  };
}

function inferAssignmentName(code: string): string | null {
  const matches = [...code.matchAll(/^\s*([A-Za-z_][\w]*)\s*(?:<-|=)\s*/gm)].map(
    (match) => match[1],
  );
  return matches.length > 0 ? matches[matches.length - 1] : null;
}

function inferTableNameFromCode(code: string): string {
  const pattern = parseDaxPattern(code);
  return pattern?.fileName.replace(/\.csv$/i, "") ?? "Sales";
}

function splitColumns(raw: string): string[] {
  return raw
    .split(",")
    .map((column) => column.trim().replace(/[`"']/g, ""))
    .filter(Boolean);
}

function pythonGroupColumns(columns: string[]): string {
  if (columns.length === 1) return `"${columns[0]}"`;
  return `[${columns.map((column) => `"${column}"`).join(", ")}]`;
}

function pythonValueColumn(column: string): string {
  return `"${column}"`;
}

function daxAggregation(aggregation: ParsedPattern["aggregation"]): string {
  if (aggregation === "mean") return "AVERAGE";
  if (aggregation === "count") return "COUNT";
  return "SUM";
}

function toDaxTableName(dataFrameName: string, fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, "");
  const normalized = stem.replace(/[^A-Za-z0-9]+/g, " ").trim();
  if (normalized) {
    return normalized
      .split(/\s+/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("");
  }
  return dataFrameName.charAt(0).toUpperCase() + dataFrameName.slice(1);
}

function extractGroupedColumn(code: string): string | null {
  const match = code.match(/group_by\(([^)]+)\)/i);
  return match ? match[1].trim().replace(/[`"']/g, "") : null;
}

function extractSummarisedValueColumn(code: string): string | null {
  const match = code.match(/summarise\([^)]*=\s*(?:sum|mean|count)\s*\(([^)]+)\)/i);
  return match ? match[1].trim().replace(/[`"']/g, "") : null;
}

function extractHeadCount(code: string): number | null {
  const match = code.match(/head\((\d+)\)/i);
  return match ? Number(match[1]) : null;
}

async function callGroq(prompt: string, jsonMode = true): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    if (process.env.NODE_ENV !== "production") {
      // Development fallback: return a safe mock so the app remains usable
      if (jsonMode) {
        return JSON.stringify({
          supported: false,
          language: "Unknown",
          confidence: 50,
          status: "Error Detected",
          errors: [
            {
              description: "GROQ_API_KEY is not configured on the server.",
              suggestedFix: "Set GROQ_API_KEY in the server environment to enable Groq calls.",
            },
          ],
          summary: "Groq API key missing; returning placeholder response for development.",
        });
      }
      return "```text\n// GROQ_API_KEY is not configured on the server.\n// To enable real conversions, set GROQ_API_KEY in your environment.\n// Returning a placeholder response for development.\n```\n";
    }

    throw new Error("GROQ_API_KEY is not configured on the server.");
  }

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
  });

  const data = (await res.json()) as GroqResponse;
  if (!res.ok) {
    throw new Error(data?.error?.message || `Groq API error (${res.status})`);
  }
  const text = data.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error("Empty response from Groq.");
  return text;
}

function extractJson(raw: string): unknown {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("Failed to parse Groq JSON response.");
  }
}

function extractCode(raw: string): string {
  const fence = raw.match(/```[a-zA-Z]*\n([\s\S]*?)```/);
  return (fence ? fence[1] : raw).trim();
}

export type AnalysisResult = {
  supported: boolean;
  language: "Python" | "R" | "Power BI (DAX)" | "Power Query (M)" | "Unknown";
  confidence: number;
  status: "Valid" | "Error Detected";
  errors: { description: string; location?: string; suggestedFix?: string }[];
  summary?: string;
};

export const analyzeCode = createServerFn({ method: "POST" })
  .validator((input: { code: string }) => {
    if (!input?.code || typeof input.code !== "string") throw new Error("Code is required");
    if (input.code.length > 50000) throw new Error("Code is too long (max 50k chars).");
    return input;
  })
  .handler(async ({ data }): Promise<AnalysisResult> => {
    const prompt = `You are a strict code analyzer. Analyze the following code and respond ONLY with valid JSON matching this TypeScript type:

{
  "supported": boolean,           // true if language is Python, R, Power BI (DAX), or Power Query (M)
  "language": "Python" | "R" | "Power BI (DAX)" | "Power Query (M)" | "Unknown",
  "confidence": number,           // 0-100 integer
  "status": "Valid" | "Error Detected",
  "errors": [                     // empty array if status is Valid
    { "description": string, "location": string, "suggestedFix": string }
  ],
  "summary": string               // one short sentence describing what the code does
}

Rules:
- If the code is not Python, R, DAX, or Power Query (M), set supported=false and language="Unknown".
- Be conservative on confidence. Only return >90 if very certain.
- For DAX, look for patterns like CALCULATE, FILTER, measures, EVALUATE.
- For Power Query M, look for "let ... in", Source =, Table.*, #"steps".
- Detect syntax errors, undefined variables, unbalanced parens/brackets.

CODE:
\`\`\`
${data.code}
\`\`\``;

    try {
      const raw = await callGroq(prompt, true);
      return extractJson(raw) as AnalysisResult;
    } catch (error) {
      return buildOfflineAnalysis(data.code, getErrorMessage(error));
    }
  });

export type ConversionResult = {
  convertedCode: string;
  explanation: {
    summary: string;
    mappings: { from: string; to: string; note?: string }[];
    notes: string[];
  };
};

export const convertCode = createServerFn({ method: "POST" })
  .validator((input: { code: string; sourceLanguage: string; targetLanguage: string }) => {
    if (!input?.code) throw new Error("Code is required");
    if (!input?.sourceLanguage || !input?.targetLanguage)
      throw new Error("Source and target languages required");
    return input;
  })
  .handler(async ({ data }): Promise<ConversionResult> => {
    const codePrompt = `Convert the following ${data.sourceLanguage} code into ${data.targetLanguage}.

Requirements:
- Preserve business logic and functionality exactly.
- Preserve comments where possible (translate comment syntax appropriately).
- Map libraries/functions to closest equivalents in the target language.
- Output must be clean, idiomatic, executable ${data.targetLanguage} code.
- Return ONLY the converted code inside a single fenced code block. No prose.

SOURCE (${data.sourceLanguage}):
\`\`\`
${data.code}
\`\`\``;

    const explainPrompt = `You converted ${data.sourceLanguage} code to ${data.targetLanguage}.
Provide a concise conversion explanation as JSON only:

{
  "summary": string,                                  // 1-2 sentence overview
  "mappings": [ { "from": string, "to": string, "note": string } ],  // library/function mappings
  "notes": [ string ]                                  // logic transformations, gotchas
}

SOURCE (${data.sourceLanguage}):
\`\`\`
${data.code}
\`\`\``;

    try {
      const [rawCode, rawExpl] = await Promise.all([
        callGroq(codePrompt, false),
        callGroq(explainPrompt, true),
      ]);

      return {
        convertedCode: extractCode(rawCode),
        explanation: extractJson(rawExpl) as ConversionResult["explanation"],
      };
    } catch (error) {
      return buildOfflineConversion(
        data.code,
        data.sourceLanguage,
        data.targetLanguage,
        getErrorMessage(error),
      );
    }
  });

export const fixCode = createServerFn({ method: "POST" })
  .validator(
    (input: {
      code: string;
      errors: { description: string; location?: string; suggestedFix?: string }[];
    }) => {
      if (!input?.code) throw new Error("Code is required");
      if (!input?.errors || input.errors.length === 0)
        throw new Error("Errors are required to fix the code");
      return input;
    },
  )
  .handler(async ({ data }): Promise<{ fixedCode: string }> => {
    const errorDetails = data.errors
      .map(
        (e) =>
          `- ${e.description} (Location: ${e.location || "Unknown"}) Suggested Fix: ${e.suggestedFix || "None"}`,
      )
      .join("\n");
    const prompt = `You are an expert code fixer. Fix the following code based on these errors:
${errorDetails}

Requirements:
- Fix ONLY the errors mentioned.
- Preserve the rest of the code exactly as it is.
- Return ONLY the fixed code inside a single fenced code block. No prose.

CODE:
\`\`\`
${data.code}
\`\`\``;

    try {
      const rawCode = await callGroq(prompt, false);
      return {
        fixedCode: extractCode(rawCode),
      };
    } catch (error) {
      throw new Error(getErrorMessage(error));
    }
  });
