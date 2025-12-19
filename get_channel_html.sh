CHANNEL_URL='https://www.youtube.com/@pbsspacetime/videos'
OUTDIR='pages'
mkdir -p "$OUTDIR"

# iterate over all videos in a channel and snarf the HTML for each one

yt-dlp --flat-playlist --print url "$CHANNEL_URL" \
| awk '!seen[$0]++' \
| while read -r url; do
    id="$(printf '%s\n' "$url" | sed -n 's/.*v=\([^&]*\).*/\1/p')"
    [ -z "$id" ] && id="$(printf '%s\n' "$url" | sed -n 's#.*/shorts/\([^?&/]*\).*#\1#p')"
    [ -z "$id" ] && id="$(printf '%s\n' "$url" | sed -n 's#.*/watch/\([^?&/]*\).*#\1#p')"
    [ -z "$id" ] && id="$(printf '%s\n' "$url" | sed -n 's#.*/\([^/?&]*\)$#\1#p')"

    echo "GET $url -> $OUTDIR/$id.html"
    wget -q \
      --user-agent="Mozilla/5.0" \
      -O "$OUTDIR/$id.html" \
      "$url"
    sleep 0.5
  done
