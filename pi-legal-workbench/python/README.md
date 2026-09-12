# Python helpers

Python handles deterministic document transformations that are awkward in TypeScript.

## Setup

Create an isolated virtual environment and install:

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r python/requirements.txt
```

On Unix-like systems, use `.venv/bin/python` instead.

## DOCX renderer

`render_docx.py` accepts structured JSON and creates an editable DOCX. Without a template, the input shape is:

```json
{
  "title": "Research Memorandum",
  "sections": [
    {
      "heading": "Question Presented",
      "paragraphs": ["Question text"]
    },
    {
      "heading": "Analysis",
      "paragraphs": ["First paragraph", "Second paragraph"]
    }
  ]
}
```

Run:

```bash
python python/render_docx.py input.json output.docx
```

For an approved `docxtpl` template:

```bash
python python/render_docx.py input.json output.docx --template template.docx
```

The helper refuses to overwrite an output unless `--overwrite` is supplied and writes a SHA-256 manifest next to the DOCX. A future Pi extension will provide path validation, artifact registration, and progress reporting around this helper.
