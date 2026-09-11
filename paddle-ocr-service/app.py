import os
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from paddleocr import PaddleOCR

app = FastAPI(
    title="LegalMetriX PaddleOCR Fallback",
    version="1.0.0",
)

OCR_LANGUAGE = os.getenv("PADDLE_OCR_LANGUAGE", "hi")

# PP-OCRv5 is used because this project needs Hindi/Devanagari as well as
# English label text. PP-OCRv5 supports Hindi; PP-OCRv6 currently does not.
ocr = PaddleOCR(
    ocr_version="PP-OCRv5",
    lang=OCR_LANGUAGE,
    use_doc_orientation_classify=False,
    use_doc_unwarping=False,
    use_textline_orientation=False,
)


def extract_result_items(result):
    """Normalize PaddleOCR results into plain OCR lines."""
    items = []

    for page in result:
        data = getattr(page, "json", None)

        if callable(data):
            data = data()

        if not isinstance(data, dict):
            continue

        page_data = data.get("res", data)
        texts = page_data.get("rec_texts", [])
        scores = page_data.get("rec_scores", [])
        boxes = page_data.get("rec_polys", page_data.get("rec_boxes", []))

        for index, text in enumerate(texts):
            value = str(text).strip()
            if not value:
                continue

            score = scores[index] if index < len(scores) else None
            box = boxes[index] if index < len(boxes) else None

            items.append(
                {
                    "text": value,
                    "confidence": round(float(score), 4) if score is not None else None,
                    "box": box.tolist() if hasattr(box, "tolist") else box,
                }
            )

    return items


@app.get("/health")
def health():
    return {
        "ok": True,
        "service": "legalmetrix-paddleocr-fallback",
        "ocr": "PaddleOCR",
        "model": "PP-OCRv5",
        "language": OCR_LANGUAGE,
    }


@app.post("/ocr")
async def run_ocr(images: list[UploadFile] = File(...)):
    if not images:
        raise HTTPException(
            status_code=400,
            detail="At least one image is required.",
        )

    all_lines = []
    confidences = []

    with tempfile.TemporaryDirectory(prefix="legalmetrix-paddle-") as temp_dir:
        for index, image in enumerate(images, start=1):
            suffix = Path(image.filename or ".jpg").suffix or ".jpg"
            image_path = Path(temp_dir) / f"photo-{index}{suffix}"
            image_path.write_bytes(await image.read())

            try:
                result = ocr.predict(str(image_path))
                lines = extract_result_items(result)
            except Exception as error:
                raise HTTPException(
                    status_code=502,
                    detail=f"PaddleOCR failed on photo {index}: {error}",
                ) from error

            all_lines.append(f"PHOTO {index}")
            all_lines.extend(item["text"] for item in lines)
            confidences.extend(
                item["confidence"]
                for item in lines
                if item["confidence"] is not None
            )

    text = "\n".join(all_lines).strip()
    confidence = (
        round((sum(confidences) / len(confidences)) * 100)
        if confidences
        else 0
    )

    return {
        "provider": "PaddleOCR",
        "model": "PP-OCRv5",
        "extractedText": text,
        "confidence": confidence,
        "lines": all_lines,
        "photoCount": len(images),
    }
