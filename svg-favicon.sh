# Converts an square SVG favicon into PNG files at required sizes
if [ -z "$1" ] || ! [ -f "$1" ] || [ "${1%.svg}" == "$1" ]; then
  echo "No SVG file supplied"
  exit 1
fi

svg_path=$1
create_png () {
  tput setaf 3;
  echo "Creating $2"
  tput sgr0;
  inkscape "$svg_path" --export-width="$1" --export-filename="$2"
}

create_png 192 "./favicon-192.png"
create_png 512 "./favicon-512.png"
create_png 180 "./apple-touch-icon.png"