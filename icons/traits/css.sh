
# Optimize SVG files
svgo svg 1>&2

# Convert SVG files to base64 encoded CSS
rm traits.css
for path in svg/*.svg;
do
    IFS='_' read -ra trait <<< $(basename -s .svg "$path")
    if [ ${#trait[@]} -gt 2 ]; then
        todo="" # todo invert
    fi
    echo -n ".trait-type-${trait[0]}" >> traits.css
    echo -n ".trait-value-${trait[1]}::before { display:block; content: url(data:image/svg+xml;" >> traits.css
    echo "base64,$(base64 -w 0 "$path")); }" >> traits.css
done
