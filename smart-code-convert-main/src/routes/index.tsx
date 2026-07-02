import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Download,
  FileCode2,
  Loader2,
  Play,
  Sparkles,
  Database,
  Trash2,
  Upload,
  Wand2,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  analyzeCode,
  convertCode,
  fixCode,
  type AnalysisResult,
  type ConversionResult,
} from "@/lib/gemini.functions";
import { runCode, type RunResult } from "@/lib/compile.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CodeMorph — AI Code Converter (Python · R · DAX · M)" },
      {
        name: "description",
        content:
          "Detect, validate and convert code between Python, R, Power BI DAX and Power Query M with Gemini AI.",
      },
      { property: "og:title", content: "CodeMorph — AI Code Converter" },
      {
        property: "og:description",
        content:
          "Detect, validate and convert code between Python, R, Power BI DAX and Power Query M with Gemini AI.",
      },
    ],
  }),
  component: Index,
});

type Lang = "Python" | "R" | "Power BI (DAX)" | "Power Query (M)";

const TARGETS: Record<Lang, Lang[]> = {
  Python: ["R", "Power BI (DAX)", "Power Query (M)"],
  R: ["Python", "Power BI (DAX)", "Power Query (M)"],
  "Power BI (DAX)": ["Python", "R", "Power Query (M)"],
  "Power Query (M)": ["Python", "R", "Power BI (DAX)"],
};

const EXAMPLES: { label: string; code: string }[] = [
  {
    label: "Python",
    code: `import pandas as pd\n\ndf = pd.read_csv("sales.csv")\ntop = (\n    df.groupby("region")["amount"].sum()\n      .sort_values(ascending=False).head(5)\n)\nprint(top)\n`,
  },
  {
    label: "R",
    code: `library(dplyr)\n\nsales <- read.csv("sales.csv")\ntop <- sales %>%\n  group_by(region) %>%\n  summarise(total = sum(amount)) %>%\n  arrange(desc(total)) %>%\n  head(5)\nprint(top)\n`,
  },
  {
    label: "DAX",
    code: `Top Region Sales :=\nCALCULATE (\n    SUM ( Sales[Amount] ),\n    TOPN ( 5, VALUES ( Sales[Region] ), SUM ( Sales[Amount] ) )\n)`,
  },
  {
    label: "M",
    code: `let\n    Source = Csv.Document(File.Contents("sales.csv"), [Delimiter=",", Encoding=65001]),\n    Promoted = Table.PromoteHeaders(Source),\n    Grouped = Table.Group(Promoted, {"region"}, {{"total", each List.Sum([amount]), type number}}),\n    Sorted = Table.Sort(Grouped, {{"total", Order.Descending}}),\n    Top5 = Table.FirstN(Sorted, 5)\nin\n    Top5`,
  },
];

function Index() {
  const [code, setCode] = useState("");
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [conversion, setConversion] = useState<ConversionResult | null>(null);
  const [target, setTarget] = useState<Lang | null>(null);
  const [sourceRunResult, setSourceRunResult] = useState<RunResult | null>(null);
  const [convertedRunResult, setConvertedRunResult] = useState<RunResult | null>(null);
  const [datasets, setDatasets] = useState<{ name: string; content: string }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const datasetRef = useRef<HTMLInputElement>(null);

  const analyzeMutation = useMutation({
    mutationFn: (input: string) => analyzeCode({ data: { code: input } }),
    onSuccess: (result) => {
      setAnalysis(result);
      setConversion(null);
      setTarget(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const convertMutation = useMutation({
    mutationFn: (vars: { code: string; source: string; target: string }) =>
      convertCode({
        data: {
          code: vars.code,
          sourceLanguage: vars.source,
          targetLanguage: vars.target,
        },
      }),
    onSuccess: (result) => setConversion(result),
    onError: (e: Error) => toast.error(e.message),
  });

  const fixMutation = useMutation({
    mutationFn: (vars: {
      code: string;
      errors: { description: string; location?: string; suggestedFix?: string }[];
    }) => fixCode({ data: vars }),
    onSuccess: (result) => {
      setCode(result.fixedCode);
      toast.success("Code auto-fixed!");
      analyzeMutation.mutate(result.fixedCode);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runSourceMutation = useMutation({
    mutationFn: (vars: {
      code: string;
      language: string;
      datasets?: { name: string; content: string }[];
    }) => runCode({ data: vars }),
    onSuccess: (result) => setSourceRunResult(result),
    onError: (e: Error) => toast.error(e.message),
  });

  const runConvertedMutation = useMutation({
    mutationFn: (vars: {
      code: string;
      language: string;
      datasets?: { name: string; content: string }[];
    }) => runCode({ data: vars }),
    onSuccess: (result) => setConvertedRunResult(result),
    onError: (e: Error) => toast.error(e.message),
  });

  const handleDatasetFile = useCallback((file: File) => {
    if (file.size > 2_000_000) {
      toast.error("Dataset file too large (max 2MB).");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setDatasets((prev) => [
        ...prev.filter((d) => d.name !== file.name),
        { name: file.name, content: String(reader.result) },
      ]);
      toast.success(`Dataset ${file.name} added.`);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleFile = useCallback((file: File) => {
    if (file.size > 200_000) {
      toast.error("File too large (max 200KB).");
      return;
    }
    setAnalysis(null);
    setConversion(null);
    setTarget(null);
    setSourceRunResult(null);
    setConvertedRunResult(null);
    const reader = new FileReader();
    reader.onload = () => setCode(String(reader.result ?? ""));
    reader.readAsText(file);
  }, []);

  const onAnalyze = () => {
    if (!code.trim()) {
      toast.error("Paste or upload some code first.");
      return;
    }
    analyzeMutation.mutate(code);
  };

  const onConvert = (t: Lang) => {
    if (!analysis) return;
    setTarget(t);
    convertMutation.mutate({ code, source: analysis.language, target: t });
  };

  const onFixCode = () => {
    if (!analysis || analysis.status !== "Error Detected") return;
    fixMutation.mutate({ code, errors: analysis.errors });
  };

  const onRunSource = () => {
    if (!analysis) {
      toast.error("Please analyze the code first to detect its language.");
      return;
    }
    runSourceMutation.mutate({ code, language: analysis.language, datasets });
  };

  const onRunConverted = () => {
    if (!conversion || !target) return;
    runConvertedMutation.mutate({ code: conversion.convertedCode, language: target, datasets });
  };

  const targetOptions = useMemo<Lang[]>(() => {
    if (!analysis?.supported) return [];
    return TARGETS[analysis.language as Lang] ?? [];
  }, [analysis]);

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  const download = (text: string, name: string) => {
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold leading-none">CodeMorph</h1>
              <p className="text-xs text-muted-foreground">
                AI code converter · Python · R · DAX · M
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-6 py-8">
        <section>
          <Card className="p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <FileCode2 className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-medium">Source code</h2>
                <span className="text-xs text-muted-foreground">
                  · type, paste, drop a file, or load an example
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={datasetRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleDatasetFile(f);
                    e.target.value = "";
                  }}
                />
                <Button variant="outline" size="sm" onClick={() => datasetRef.current?.click()}>
                  <Database className="mr-1.5 h-4 w-4" /> Add Dataset
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".py,.r,.R,.dax,.pq,.m,.txt"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                    e.target.value = "";
                  }}
                />
                <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                  <Upload className="mr-1.5 h-4 w-4" /> Upload
                </Button>
                {code && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setCode("");
                      setAnalysis(null);
                      setConversion(null);
                      setTarget(null);
                      setSourceRunResult(null);
                      setConvertedRunResult(null);
                    }}
                  >
                    Clear
                  </Button>
                )}
                <Button size="sm" onClick={onAnalyze} disabled={analyzeMutation.isPending}>
                  {analyzeMutation.isPending ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <Wand2 className="mr-1.5 h-4 w-4" />
                  )}
                  Analyze code
                </Button>
                {analysis && analysis.status === "Valid" && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={onRunSource}
                    disabled={runSourceMutation.isPending}
                  >
                    {runSourceMutation.isPending ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="mr-1.5 h-4 w-4" />
                    )}
                    Run Code
                  </Button>
                )}
              </div>
            </div>

            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Try an example:</span>
              {EXAMPLES.map((ex) => (
                <Button
                  key={ex.label}
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-7 px-2 text-xs"
                  onClick={() => {
                    setCode(ex.code);
                    setAnalysis(null);
                    setConversion(null);
                    setTarget(null);
                    setSourceRunResult(null);
                    setConvertedRunResult(null);
                  }}
                >
                  {ex.label}
                </Button>
              ))}
            </div>

            <Textarea
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setAnalysis(null);
                setConversion(null);
                setTarget(null);
                setSourceRunResult(null);
                setConvertedRunResult(null);
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                const f = e.dataTransfer.files?.[0];
                if (f) {
                  e.preventDefault();
                  handleFile(f);
                }
              }}
              placeholder="Type or paste your Python, R, Power BI (DAX) or Power Query (M) code here — you can also drop a file onto this box..."
              className="min-h-[260px] font-mono text-sm"
              spellCheck={false}
            />
            <div className="mt-1.5 flex justify-between text-xs text-muted-foreground">
              <span>Tip: you can edit freely after loading an example or file.</span>
              <span>{code.length.toLocaleString()} chars</span>
            </div>
            {datasets.length > 0 && (
              <div className="mt-4 rounded-md border border-border bg-card p-4">
                <div className="mb-2 text-sm font-medium">Datasets</div>
                <div className="flex flex-wrap gap-2">
                  {datasets.map((d) => (
                    <Badge
                      key={d.name}
                      variant="secondary"
                      className="flex items-center gap-1 py-1"
                    >
                      <Database className="h-3 w-3" />
                      {d.name}
                      <button
                        onClick={() => setDatasets((prev) => prev.filter((x) => x.name !== d.name))}
                        className="ml-1 hover:text-destructive"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {sourceRunResult && (
              <div className="mt-4 rounded-md border border-border bg-card p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <Play className="h-4 w-4 text-muted-foreground" />
                  Execution Output
                  {sourceRunResult.success ? (
                    <Badge
                      variant="outline"
                      className="text-emerald-500 border-emerald-500/20 bg-emerald-500/10"
                    >
                      Success
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="text-destructive border-destructive/20 bg-destructive/10"
                    >
                      Failed
                    </Badge>
                  )}
                </div>
                <pre className="whitespace-pre-wrap rounded bg-muted p-3 text-xs font-mono">
                  {sourceRunResult.error || sourceRunResult.output || "No output"}
                </pre>
                {sourceRunResult.images && sourceRunResult.images.length > 0 && (
                  <div className="mt-4 flex flex-col gap-2">
                    {sourceRunResult.images.map((img, i) => (
                      <img
                        key={i}
                        src={img}
                        alt="Generated Plot"
                        className="max-w-full rounded border border-border"
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </Card>
        </section>

        {analysis && (
          <section>
            <Card className="p-5">
              <AnalysisView
                result={analysis}
                onFixCode={onFixCode}
                isFixing={fixMutation.isPending}
              />
              {analysis.supported && targetOptions.length > 0 && (
                <>
                  <Separator className="my-5" />
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-sm font-medium">Convert to:</span>
                    {targetOptions.map((t) => (
                      <Button
                        key={t}
                        variant={target === t ? "default" : "outline"}
                        size="sm"
                        onClick={() => onConvert(t)}
                        disabled={convertMutation.isPending}
                      >
                        {convertMutation.isPending && target === t ? (
                          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                        ) : null}
                        {t}
                      </Button>
                    ))}
                  </div>
                </>
              )}
            </Card>
          </section>
        )}

        {conversion && target && (
          <section className="grid gap-6 lg:grid-cols-2">
            <Card className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-medium">Converted code · {target}</h3>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={onRunConverted}
                    disabled={runConvertedMutation.isPending}
                  >
                    {runConvertedMutation.isPending ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="mr-1.5 h-4 w-4" />
                    )}
                    Run
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => copy(conversion.convertedCode)}>
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      download(conversion.convertedCode, `converted.${extForLang(target)}`)
                    }
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <pre className="max-h-[500px] overflow-auto rounded-md bg-muted p-4 text-xs leading-relaxed">
                <code>{conversion.convertedCode}</code>
              </pre>
              {convertedRunResult && (
                <div className="mt-4 rounded-md border border-border bg-card p-4">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <Play className="h-4 w-4 text-muted-foreground" />
                    Execution Output
                    {convertedRunResult.success ? (
                      <Badge
                        variant="outline"
                        className="text-emerald-500 border-emerald-500/20 bg-emerald-500/10"
                      >
                        Success
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="text-destructive border-destructive/20 bg-destructive/10"
                      >
                        Failed
                      </Badge>
                    )}
                  </div>
                  <pre className="whitespace-pre-wrap rounded bg-muted p-3 text-xs font-mono">
                    {convertedRunResult.error || convertedRunResult.output || "No output"}
                  </pre>
                  {convertedRunResult.images && convertedRunResult.images.length > 0 && (
                    <div className="mt-4 flex flex-col gap-2">
                      {convertedRunResult.images.map((img, i) => (
                        <img
                          key={i}
                          src={img}
                          alt="Generated Plot"
                          className="max-w-full rounded border border-border"
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Card>

            <Card className="p-5">
              <h3 className="mb-3 text-sm font-medium">Conversion explanation</h3>
              <p className="text-sm text-muted-foreground">{conversion.explanation.summary}</p>
              {conversion.explanation.mappings.length > 0 && (
                <div className="mt-4">
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Mappings
                  </h4>
                  <ul className="space-y-2">
                    {conversion.explanation.mappings.map((m, i) => (
                      <li key={i} className="rounded-md border border-border bg-card p-3 text-sm">
                        <div className="flex items-center gap-2 font-mono text-xs">
                          <span className="rounded bg-muted px-1.5 py-0.5">{m.from}</span>
                          <span className="text-muted-foreground">→</span>
                          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">
                            {m.to}
                          </span>
                        </div>
                        {m.note && <p className="mt-1 text-xs text-muted-foreground">{m.note}</p>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {conversion.explanation.notes.length > 0 && (
                <div className="mt-4">
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Notes
                  </h4>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                    {conversion.explanation.notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          </section>
        )}
      </main>
    </div>
  );
}

function AnalysisView({
  result,
  onFixCode,
  isFixing,
}: {
  result: AnalysisResult;
  onFixCode?: () => void;
  isFixing?: boolean;
}) {
  if (!result.supported) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
        <AlertCircle className="mt-0.5 h-5 w-5 text-destructive" />
        <div>
          <h3 className="font-semibold text-destructive">Unsupported Language Detected</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            The provided code is not recognized as Python, R, Power BI (DAX), or Power Query (M).
            Please provide valid code from one of the supported languages.
          </p>
        </div>
      </div>
    );
  }

  const isError = result.status === "Error Detected";

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-border p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Detected Language
          </p>
          <p className="mt-1 text-lg font-semibold">{result.language}</p>
          <div className="mt-3">
            <div className="mb-1 flex justify-between text-xs text-muted-foreground">
              <span>Confidence</span>
              <span>{result.confidence}%</span>
            </div>
            <Progress value={result.confidence} />
          </div>
        </div>
        <div
          className={`rounded-lg border p-4 ${
            isError ? "border-destructive/30 bg-destructive/5" : "border-border bg-card"
          }`}
        >
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Code Status
          </p>
          <div className="mt-1 flex items-center gap-2">
            {isError ? (
              <AlertCircle className="h-5 w-5 text-destructive" />
            ) : (
              <CheckCircle2
                className="h-5 w-5 text-[oklch(var(--success))]"
                style={{ color: "oklch(0.62 0.16 155)" }}
              />
            )}
            <span className="text-lg font-semibold">{isError ? "Error Detected" : "Valid"}</span>
          </div>
          {result.summary && <p className="mt-2 text-sm text-muted-foreground">{result.summary}</p>}
        </div>
      </div>

      {isError && result.errors.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Errors & suggested fixes
            </h4>
            {onFixCode && (
              <Button
                size="sm"
                variant="outline"
                onClick={onFixCode}
                disabled={isFixing}
                className="border-destructive/30 text-destructive hover:bg-destructive hover:text-destructive-foreground"
              >
                {isFixing ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Wrench className="mr-1.5 h-4 w-4" />
                )}
                Auto-Fix Code
              </Button>
            )}
          </div>
          {result.errors.map((err, i) => (
            <div
              key={i}
              className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"
            >
              <p className="font-medium text-destructive">{err.description}</p>
              {err.location && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Location: <span className="font-mono">{err.location}</span>
                </p>
              )}
              {err.suggestedFix && (
                <p className="mt-2 text-xs">
                  <span className="font-semibold">Suggested fix: </span>
                  <span className="text-muted-foreground">{err.suggestedFix}</span>
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function extForLang(lang: string): string {
  if (lang === "Python") return "py";
  if (lang === "R") return "R";
  if (lang.includes("DAX")) return "dax";
  return "pq";
}
