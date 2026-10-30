from pathlib import Path
from shutil import copy2

ROOT = Path(__file__).resolve().parent
FRONTEND = ROOT / "frontend"
PUBLIC = ROOT / "public"


def main():
    PUBLIC.mkdir(exist_ok=True)
    for source in FRONTEND.rglob("*"):
        relative_path = source.relative_to(FRONTEND)
        destination = PUBLIC / relative_path
        if source.is_dir():
            destination.mkdir(parents=True, exist_ok=True)
        else:
            destination.parent.mkdir(parents=True, exist_ok=True)
            copy2(str(source), str(destination))


if __name__ == "__main__":
    main()
