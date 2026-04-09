"""
Docling document parser.
Converts PDF/Word/PPT/image files to structured Markdown + metadata.
"""

import asyncio
import json
from pathlib import Path


async def parse_document(file_path: str, options: dict) -> dict:
    from docling.document_converter import DocumentConverter
    from docling.datamodel.pipeline_options import PdfPipelineOptions
    from docling.document_converter import PdfFormatOption
    from docling.datamodel.base_models import InputFormat

    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    # Configure converter
    converter = DocumentConverter()

    # Convert
    result = converter.convert(file_path)

    # Export to markdown
    markdown_content = result.document.export_to_markdown()

    # Extract tables
    tables = []
    for table in result.document.tables:
        try:
            tables.append({
                "data": table.export_to_dataframe().to_csv(index=False),
                "page": getattr(table.prov[0], "page_no", None) if table.prov else None,
            })
        except Exception:
            pass

    # Extract images / figures
    images = []
    for pic in result.document.pictures:
        try:
            images.append({
                "caption": pic.caption_text(result.document) if pic.captions else None,
                "page": getattr(pic.prov[0], "page_no", None) if pic.prov else None,
            })
        except Exception:
            pass

    # Metadata
    metadata = {
        "page_count": getattr(result.document, "num_pages", None),
        "format": str(path.suffix).lstrip(".").upper(),
        "title": getattr(result.document, "title", None),
    }

    return {
        "content": markdown_content,
        "tables": tables,
        "images": images,
        "metadata": metadata,
    }
