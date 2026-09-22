        else:
            current = candidate
    if current:
        chunks.append(current)
    return chunks


def compute_sha256(file_path: Path) -> str:
    """Compute sha256 hex digest of a file."""
    h = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


class LessonSegmenter:
    """
    Segments a full book PDF into standard Workspace packages:
    - unit_01_<slug>/ (unit_manifest.json)
      - lesson_01_<slug>/ (L_01_<slug>.pdf, lesson_manifest.json, text/, lesson_full_text.txt)
    - index.json (master workspace index)
    - edu7-content-package.json (canonical package manifest)
    """

    def __init__(self, reader: PdfReader, page_mapper: PageMappingEngine):
        self.reader = reader
        self.mapper = page_mapper

    def segment_book(
        self,
        units: List[Dict[str, Any]],
        workspace_dir: Path,
        coordinates: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        workspace_dir.mkdir(parents=True, exist_ok=True)
        raw_meta = self.reader.get_metadata()
        coords = coordinates or {}

        subject = coords.get("subject", raw_meta.get("subject", "GENERAL"))
        grade = coords.get("grade", "G07")