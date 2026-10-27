import { describe, expect, it } from "vitest";
import { htmlToText } from "../../../extensions/tools/web/text.ts";

describe("htmlToText", () => {
	it("strips head, script, style, noscript, template, and svg blocks", () => {
		const html =
			"<html><head><title>t</title></head><body><script>bad()</script><style>.x{}</style><noscript>no</noscript><template>tpl</template><svg><circle/></svg><p>kept</p></body></html>";
		expect(htmlToText(html)).toBe("kept");
	});

	it("strips comments and tags", () => {
		expect(htmlToText("<!-- hidden --><b>bold</b> plain")).toBe("bold plain");
	});

	it("converts br and block-end tags to newlines", () => {
		expect(htmlToText("a<br>b")).toBe("a\nb");
		expect(htmlToText("<div>one</div><p>two</p>")).toBe("one\ntwo");
	});

	it("decodes named entities", () => {
		expect(htmlToText("a &amp; b &lt; c &gt; d &quot;e&quot; f&apos;g h&nbsp;i")).toBe(
			'a & b < c > d "e" f\'g h i',
		);
	});

	it("decodes numeric and hex entities", () => {
		expect(htmlToText("&#65; &#x41;")).toBe("A A");
	});

	it("leaves invalid entities as-is", () => {
		expect(htmlToText("100 &nosuch; &#zz;")).toBe("100 &nosuch; &#zz;");
	});

	it("collapses whitespace, removes carriage returns, and trims", () => {
		expect(htmlToText("  a \t b  \r\nc   \n\n\n\nd  ")).toBe("a b\nc\n\nd");
	});
});
