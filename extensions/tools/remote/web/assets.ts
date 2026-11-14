export interface CdnAsset {

	readonly url: string;

	readonly integrity: string;
}

const CDN = "https://cdn.jsdelivr.net/npm";

export const CDN_ORIGIN = "https://cdn.jsdelivr.net";

export const XTERM_STYLESHEET: CdnAsset = {
	url: `${CDN}/@xterm/xterm@5.5.0/css/xterm.css`,
	integrity: "sha384-8Xk9wy/gzEDUKrXtrmCFa2bBuK3BpjpDuL/p0SeKQX19Khl/M+lHOgD/CyYf7efP",
};

export const XTERM_SCRIPTS: readonly CdnAsset[] = [
	{
		url: `${CDN}/@xterm/xterm@5.5.0/lib/xterm.js`,
		integrity: "sha384-M169f14mRZOXm3hD/v2Ti0ThIT/RnAQagXA9nlE15yHAtrW19gdePJh/HaTzUOe/",
	},
	{
		url: `${CDN}/@xterm/addon-webgl@0.18.0/lib/addon-webgl.js`,
		integrity: "sha384-AkzdQDeATxpW8V7I2EPcwg17qAoLQMjEFHb//1QaAAIyIlbDAHGKno5+huH7RKxq",
	},
	{
		url: `${CDN}/@xterm/addon-fit@0.10.0/lib/addon-fit.js`,
		integrity: "sha384-iF+jqbuti4XlB64clWgFWYEscb+UnSRv3VgVikGYZu+otNFnSHr7y7NcKfBnGizn",
	},
	{
		url: `${CDN}/@xterm/addon-unicode11@0.8.0/lib/addon-unicode11.js`,
		integrity: "sha384-7DkEj65mwuJpyTemyRshYB1TDCUcpXHiCcSt0agkXn8Zz8nOqajgB6EoeULHiS1O",
	},
];
