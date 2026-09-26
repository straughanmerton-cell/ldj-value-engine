import { describe, expect, it } from "vitest";
import {
  BingSearchProvider,
  decodeHtmlEntities,
  parseBingResults,
  stripHtmlTags,
  unwrapBingUrl
} from "../src/bing.js";

/**
 * 免 Key 网页检索（客户 2026-09-26 追加需求）的最小保证：
 * 结构对得上就解析出真实来源，结构对不上就返回 0 条——**绝不猜、绝不编来源**（§62-1）。
 */

/** 与真实结果页一致的片段：`li.b_algo` + `h2>a` + `.b_caption>p`。 */
const RESULT_HTML = `
<ol id="b_results">
<li class="b_algo" data-id iid=SERP.5335>
  <div class="b_tpcn"><a class="tilk" href="https://baike.baidu.com/item/%E5%86%B0%E5%B2%9B/26889"><div class="tptt">baidu.com</div></a></div>
  <h2 class=""><a target="_blank" href="https://baike.baidu.com/item/%E5%86%B0%E5%B2%9B/26889"><strong>冰岛</strong>古树熟茶（2018）_百度百科</a></h2>
  <div class="b_caption"><p class="b_lineclamp2">冰岛古树&#33590;，汤色红浓，甜润细腻，2018 年出品的熟茶标杆，市场价一路走高。</p></div>
</li>
<li class="b_algo" data-id iid=SERP.5336>
  <h2><a href="https://www.bing.com/ck/a?u=a1aHR0cHM6Ly90ZWEuZXhhbXBsZS5jb20vcC8xMjM&ntb=1">某高端熟茶 2021 年产品页</a></h2>
  <div class="b_caption"><p>这是第二段摘要。</p></div>
</li>
<li class="b_algo" data-id iid=SERP.5337>
  <h2><a href="https://duplicate.example.com/a">重复来源</a></h2>
  <div class="b_caption"><p>第一次出现。</p></div>
</li>
<li class="b_algo" data-id iid=SERP.5338>
  <h2><a href="https://duplicate.example.com/a">重复来源</a></h2>
  <div class="b_caption"><p>第二次出现应被去重。</p></div>
</li>
</ol>`;

describe("Bing 结果页解析", () => {
  it("解析出标题 / 真实链接 / 摘要 / 域名，并按上限截断", () => {
    const results = parseBingResults(RESULT_HTML, 10);
    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({
      title: "冰岛古树熟茶（2018）_百度百科",
      url: "https://baike.baidu.com/item/%E5%86%B0%E5%B2%9B/26889",
      sourceDomain: "baike.baidu.com"
    });
    expect(results[0]?.snippet).toContain("汤色红浓");
    expect(parseBingResults(RESULT_HTML, 2)).toHaveLength(2);
  });

  it("把 bing 跳转链接还原成真实地址", () => {
    const results = parseBingResults(RESULT_HTML, 10);
    expect(results[1]?.url).toBe("https://tea.example.com/p/123");
    expect(results[1]?.sourceDomain).toBe("tea.example.com");
  });

  it("同一链接只保留一次", () => {
    const urls = parseBingResults(RESULT_HTML, 10).map((item) => item.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("结构对不上时返回 0 条，不臆造来源", () => {
    expect(parseBingResults("<html><body>没有结果区</body></html>", 10)).toEqual([]);
    expect(parseBingResults("", 10)).toEqual([]);
    expect(parseBingResults(RESULT_HTML, 0)).toEqual([]);
  });
});

describe("HTML 处理工具", () => {
  it("解码数字实体与常见命名实体", () => {
    expect(decodeHtmlEntities("冰岛古树&#33590;&amp;&quot;熟茶&quot;")).toBe(
      '冰岛古树茶&"熟茶"'
    );
    expect(decodeHtmlEntities("&#x51B0;岛")).toBe("冰岛");
    expect(decodeHtmlEntities("&unknown;")).toBe("&unknown;");
  });

  it("去标签并压平空白", () => {
    expect(stripHtmlTags("  <strong>冰岛</strong>\n  古树\t熟茶  ")).toBe("冰岛 古树 熟茶");
  });

  it("非 bing 链接原样返回", () => {
    expect(unwrapBingUrl("https://tea.example.com/x")).toBe("https://tea.example.com/x");
    expect(unwrapBingUrl("not-a-url")).toBe("not-a-url");
  });
});

describe("BingSearchProvider", () => {
  it("空查询不打网络请求", async () => {
    let called = 0;
    const provider = new BingSearchProvider({
      fetchImpl: (async () => {
        called += 1;
        return new Response("");
      }) as unknown as typeof fetch
    });
    expect(await provider.search({ query: "   " })).toEqual([]);
    expect(called).toBe(0);
    expect(provider.name).toBe("bing");
  });

  it("HTTP 失败抛错（由调用方降级，不返回假结果）", async () => {
    const provider = new BingSearchProvider({
      fetchImpl: (async () => new Response("blocked", { status: 503 })) as unknown as typeof fetch
    });
    await expect(provider.search({ query: "冰岛古树熟茶" })).rejects.toThrow("503");
  });

  it("正常返回结果，并把查询参数带进请求地址", async () => {
    let requested = "";
    const provider = new BingSearchProvider({
      fetchImpl: (async (url: string) => {
        requested = url;
        return new Response(RESULT_HTML, { status: 200 });
      }) as unknown as typeof fetch
    });
    const results = await provider.search({ query: "冰岛古树熟茶 价格", maxResults: 5 });
    expect(results).toHaveLength(3);
    expect(requested).toContain(encodeURIComponent("冰岛古树熟茶 价格"));
    expect(requested).toContain("setlang=zh-CN");
  });
});
