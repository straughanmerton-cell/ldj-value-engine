import { describe, expect, it } from "vitest";
import { So360SearchProvider, parseSo360Results } from "../src/so360.js";

/**
 * 免 Key 网页检索（客户 2026-09-26 追加需求）的最小保证：
 * 结构对得上就解析出真实来源，结构对不上就返回 0 条——**绝不猜、绝不编来源**（§62-1）。
 *
 * 这一组用例与真实结果页保持同构（`<h3   class="res-title">` 的多空格写法、
 * `data-mdurl` / `href` 两种地址、站内 onebox 与聚合块）。
 */

/** 与真实结果页一致的片段：`li.res-list` + `h3.res-title > a` + `p.res-desc`。 */
const RESULT_HTML = `
<ul class="result">
<li class="res-list res-list-1">
  <h3   class="res-title"><a href="https://www.so.com/link?m=aaa" data-mdurl="https://www.smzdm.com/p/152265995/" rel="noopener" data-res='{"tp":21,"pos":1}'>大益茶类_大益 经典<em>7572</em> 普洱熟茶多少钱-什么值得买</a></h3>
  <div class="res-rich"><span class="g-c-gray">2025年3月8日&nbsp;-&nbsp;</span><span class="res-list-summary"><em>大益</em>7572 的价格区间为 300–900 元/饼。</span></div>
  <p class="g-linkinfo"><cite><a href="https://www.so.com/link?m=bbb" class="g-linkinfo-a">www.smzdm.com</a></cite></p>
</li>
<li class="res-list">
  <h3 class="res-title " > <a href="https://www.so.com/link?m=ccc" data-mdurl="https://teabench.example.com/guide" rel="noopener">冰岛古树&#33590;价格与山头对照（2025）</a></h3>
  <p class="res-desc"><span class="gray">2025年1月6日&nbsp;-&nbsp;</span>冰岛老树熟茶的价格或许会继续涨，市场价 <em>8000</em> 元/饼起。</p>
</li>
<li class="res-list">
  <h3 class="res-title"><a href="https://teas.example.com/p/9">同一来源第二次出现</a></h3>
  <p class="res-desc">应被去重。</p>
</li>
<li class="res-list">
  <h3 class="res-title"><a href="https://teas.example.com/p/9">同一来源第二次出现</a></h3>
  <p class="res-desc">重复项。</p>
</li>
<li class="res-list res-list-onebox">
  <h3 class="title"><a href="http://map.360.cn/?t=map&k=%E8%8C%B6" target="_blank">冰岛古树熟茶 - 360地图</a></h3>
  <div class="content-wrapper"><p class="poi-address">地址：普洱市思茅区</p></div>
</li>
<li class="res-list res-list-video">
  <h3 class="g-title "><a href="https://tv.360kan.com/s?q=%E5%86%B0%E5%B2%9B" target="_blank"><div class="g-title-inner">冰岛古树熟茶-短视频大全-高清在线观看</div></a></h3>
</li>
<li class="res-list res-list-img">
  <h3 class="g-title "><a href="https://image.so.com/i?q=%E5%86%B0%E5%B2%9B" target="_blank"><div class="g-title-inner">冰岛古树熟茶_360图片</div></a></h3>
</li>
<li class="res-list res-list-ai">
  <h3 class="res-title"><a href="https://ai.so.com/search/so123" data-initurl="https://wenda.so.com/q/1" target="_blank">冰岛古树熟茶价格?</a></h3>
</li>
</ul>`;

describe("360 结果页解析", () => {
  it("解析出标题 / data-mdurl 真实链接 / 摘要 / 域名，并按上限截断", () => {
    const results = parseSo360Results(RESULT_HTML, 10);
    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({
      title: "大益茶类_大益 经典7572 普洱熟茶多少钱-什么值得买",
      url: "https://www.smzdm.com/p/152265995/",
      sourceDomain: "www.smzdm.com"
    });
    expect(results[0]?.snippet).toContain("300–900 元/饼");
    expect(parseSo360Results(RESULT_HTML, 1)).toHaveLength(1);
  });

  it("实体与高亮标签被还原成能读的文本", () => {
    const results = parseSo360Results(RESULT_HTML, 10);
    expect(results[1]?.title).toBe("冰岛古树茶价格与山头对照（2025）");
    expect(results[1]?.snippet).toContain("8000 元/饼起");
  });

  it("站内聚合块（地图 / 短视频 / 图片 / AI 答案）一律丢弃", () => {
    const domains = parseSo360Results(RESULT_HTML, 10).map((item) => item.sourceDomain);
    expect(domains).not.toContain("map.360.cn");
    expect(domains).not.toContain("tv.360kan.com");
    expect(domains).not.toContain("image.so.com");
    expect(domains).not.toContain("ai.so.com");
  });

  it("同一链接只保留一次", () => {
    const urls = parseSo360Results(RESULT_HTML, 10).map((item) => item.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("没有 data-mdurl 时退回 href，但拿到 so.com 跳转链接就丢弃该条", () => {
    const html = `<li class="res-list"><h3 class="res-title"><a href="https://www.so.com/link?m=x">跳转链接拿不到真实地址</a></h3></li>`;
    expect(parseSo360Results(html, 10)).toEqual([]);
  });

  it("结构对不上时返回 0 条，不臆造来源", () => {
    expect(parseSo360Results("<html><body>没有结果区</body></html>", 10)).toEqual([]);
    expect(parseSo360Results("", 10)).toEqual([]);
    expect(parseSo360Results(RESULT_HTML, 0)).toEqual([]);
  });
});

describe("So360SearchProvider", () => {
  it("通道名为 so360，查询走 /s?q=", async () => {
    const calls: string[] = [];
    const provider = new So360SearchProvider({
      fetchImpl: (async (input: string | URL | Request) => {
        calls.push(String(input));
        return new Response(RESULT_HTML, { status: 200 });
      }) as unknown as typeof fetch
    });
    const results = await provider.search({ query: "冰岛古树熟茶 价格", maxResults: 2 });
    expect(provider.name).toBe("so360");
    expect(calls[0]).toContain("https://www.so.com/s?q=");
    expect(calls[0]).toContain(encodeURIComponent("冰岛古树熟茶 价格"));
    expect(results).toHaveLength(2);
  });

  it("空查询不发请求；HTTP 非 200 抛出交给调用方降级", async () => {
    const provider = new So360SearchProvider({
      fetchImpl: (async () => new Response("nope", { status: 503 })) as unknown as typeof fetch
    });
    await expect(provider.search({ query: "   " })).resolves.toEqual([]);
    await expect(provider.search({ query: "冰岛" })).rejects.toThrow("503");
  });

  it("碰到 360 的兜底页（无 res-list 标记）会重试，拿到真结果就照常返回", async () => {
    let calls = 0;
    const provider = new So360SearchProvider({
      retryDelayMs: 1,
      fetchImpl: (async () => {
        calls += 1;
        return new Response(calls === 1 ? '<!DOCTYPE html><title>360搜索</title>' : RESULT_HTML, {
          status: 200
        });
      }) as unknown as typeof fetch
    });
    const results = await provider.search({ query: "冰岛古树熟茶 价格", maxResults: 2 });
    expect(calls).toBe(2);
    expect(results).toHaveLength(2);
  });

  it("兜底页连续出现时重试次数有上限，用完就如实返回 0 条（不谎报、不空转）", async () => {
    let calls = 0;
    const provider = new So360SearchProvider({
      retryDelayMs: 1,
      fetchImpl: (async () => {
        calls += 1;
        return new Response('<!DOCTYPE html><title>360搜索</title>', { status: 200 });
      }) as unknown as typeof fetch
    });
    await expect(provider.search({ query: "冰岛古树熟茶 价格" })).resolves.toEqual([]);
    expect(calls).toBe(3);
  });

  /**
   * 360 是抓取式通道，同一 IP 连发会被「访问异常」页挡住（实测连发 6 次全中）。
   * 因此：出过结果的查询短期缓存（同一个产品名「再改一版」时那三条查询逐字相同），
   * 查空的查询**不缓存**——那多半是限流，下一次该重新去问。
   */
  it("同一查询 5 分钟内命中缓存：不再重复打 360，结果照旧", async () => {
    let calls = 0;
    const provider = new So360SearchProvider({
      fetchImpl: (async () => {
        calls += 1;
        return new Response(RESULT_HTML, { status: 200 });
      }) as unknown as typeof fetch
    });
    const first = await provider.search({ query: "冰岛古树熟茶 价格", maxResults: 3 });
    const second = await provider.search({ query: "冰岛古树熟茶 价格", maxResults: 3 });
    expect(calls).toBe(1);
    expect(second).toEqual(first);
    expect(second).toHaveLength(3);
  });

  it("查空的查询不进缓存：下一次仍然重新去问（限流页不能被记成「没有对标」）", async () => {
    let calls = 0;
    const provider = new So360SearchProvider({
      retryDelayMs: 1,
      fetchImpl: (async () => {
        calls += 1;
        return new Response("<!DOCTYPE html><title>访问异常页面</title>", { status: 200 });
      }) as unknown as typeof fetch
    });
    await expect(provider.search({ query: "冰岛古树熟茶 价格" })).resolves.toEqual([]);
    await expect(provider.search({ query: "冰岛古树熟茶 价格" })).resolves.toEqual([]);
    expect(calls).toBe(6);
  });

  it("cacheTtlMs: 0 关闭缓存（每次都是真请求）", async () => {
    let calls = 0;
    const provider = new So360SearchProvider({
      cacheTtlMs: 0,
      fetchImpl: (async () => {
        calls += 1;
        return new Response(RESULT_HTML, { status: 200 });
      }) as unknown as typeof fetch
    });
    await provider.search({ query: "冰岛古树熟茶 价格" });
    await provider.search({ query: "冰岛古树熟茶 价格" });
    expect(calls).toBe(2);
  });
});
