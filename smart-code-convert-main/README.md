# Proposed Framework: CodeMorph

We propose CodeMorph, a framework that unifies Large Language Models (LLMs) and modern web technologies for automated analysis, validation, and conversion of data science and analytics code. By designing CodeMorph to interact with domain users via an intuitive interface, we hope to reduce the need for specialized syntax knowledge across multiple languages and improve the experience for end-users. CodeMorph primarily consists of three modules: the Input & Pre-processing module, the Analysis & Validation module, and the Conversion & Explanation module.

## 1.1 Input & Pre-processing Module

The Input & Pre-processing module handles the initial user interaction. The user queries CodeMorph by providing source code in their preferred data language (e.g., Python, R, Power BI DAX, or Power Query M). The queries are pre-processed through a unified editor interface where the user can directly type, paste, or upload code files. The pre-processing ensures that the raw text is cleanly formatted and constrained within allowable file sizes before being dispatched. If the user's input is empty or invalid, CodeMorph detects the missing information and requests the user to provide the necessary code snippets.

## 1.2 Analysis & Validation Module

The Analysis & Validation module is used to evaluate the provided code descriptions and check their grammar. This module receives the output of the pre-processing stage and passes it to the `analyzeCode` formulator. The formulator leverages the Google Gemini LLM via prompt engineering to automatically detect the programming language and assess syntax validity. If the syntax test fails, it enters a diagnostic phase where CodeMorph formulates an error report containing specific error descriptions, pinpointed locations, and suggested fixes based on its own feedback. Otherwise, the code is marked as valid and supported, opening up options for cross-language conversion.

## 1.3 Conversion & Explanation Module

The Conversion & Explanation module handles the final translation. Once a valid code snippet is selected for conversion, the system targets one of the compatible cross-languages. The `convertCode` block translates the logic into the corresponding math formulas and operations of the target language. Additionally, an 'Interpreter' block collects the LLM's solution and interprets it in natural language. The solution is subjected to a semantic check where it formats a detailed explanation containing structural notes and direct syntax mappings (e.g., how a `pandas.groupby` maps to a `dplyr::group_by`). Finally, the solution and interpretation are formatted by the frontend and presented to the user, who can seamlessly copy or download the results.

# 2 Applications

Our framework can solve generic code translation problems based on their contextual logic. In this part, we introduce three basic applications, including single-language validation, cross-language translation, and file-based processing.

## 2.1 Application 1: Single-Language Validation

In the single-language validation application, we assume the user has provided a complete code snippet but needs to verify its correctness. This application is often used in educational or debugging contexts. The 'Formulator' block processes the code, with the ability to automatically detect the language. It then generates an error diagnostic report if necessary. The user input can be directly edited, and the rest of the parts will be re-generated accordingly to ensure the code is error-free.

## 2.2 Application 2: Cross-Language Translation

In many scenarios, users may need to port existing logic from one ecosystem to another (e.g., moving data preparation from Python to Power Query M). The model guides the user to provide the source code and then provides the translated answer directly to the user. For people without a deep background in the target language, the system enables them to enjoy the benefits of accurate translation alongside natural language dialogues and specific mapping explanations.

## 2.3 Application 3: File-based Processing

There are scenarios where the code for an optimization or data problem cannot be concisely typed or is stored externally. To address this, we design CodeMorph to accept external data files. Users may drag and drop `.py`, `.R`, `.dax`, or `.pq` files directly into the system. The data is parsed locally before being sent to the LLM to preserve formatting and provide a seamless transition from local development to AI-assisted conversion.

# 3 Implementation & Technology Stack

CodeMorph permits online LLM services as the base model. In this section, we introduce the architectural stack utilized to build the system interface and handle API orchestration.

- **Core Framework:** We utilize **React 19** and **TanStack Start** as the full-stack framework. TanStack Start provides type-safe, file-based routing, which manages the application state across the different modules.
- **Styling & Components:** The interface is built using **Tailwind CSS v4** and **Radix UI** (via **shadcn/ui**). This ensures an accessible, highly responsive, and interactive frontend.
- **LLM Integration:** The core conversion and analysis rely on the **Google Gemini API** (`@google/genai`). We utilize structured prompt engineering to enforce strict JSON responses from the LLM, ensuring the frontend can reliably parse mappings, errors, and translated code.
- **Build System:** The project is bundled using **Vite**, with **TypeScript** enforcing type safety across the entire codebase. **ESLint** and **Prettier** are utilized for strict code formatting.
