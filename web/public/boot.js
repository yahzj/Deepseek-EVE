/* 首屏预置脚本：业务包加载前就开始值班。
 * 负责：真实等待秒数、断网/脚本无法解析/长时间无响应的自检代号、一键反馈、备用入口。
 * SG-01 / SG-02 / SG-03 的玩家文案只在这里（那时业务包与本地化表都还没加载）；
 * 其余代号在 packages/data/src/l10n/table.ts，代号对照见 docs/boot-codes.md。 */
(function () {
  'use strict'

  var FEEDBACK_ENDPOINT = 'https://game.bajibaji.party:7777/api/feedback'
  var SLOW_MS = 15000
  var FAIL_MS = 75000
  try {
    var connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection
    var effective = connection && connection.effectiveType ? String(connection.effectiveType) : ''
    if (effective === 'slow-2g' || effective === '2g') FAIL_MS = 150000
    else if (effective === '3g') FAIL_MS = 110000
  } catch (err) {}
  var SELF_HOSTS = ['game.bajibaji.party', '123.207.188.192']

  var COPY = {
    'SG-01': {
      title: '星门同步链路无响应',
      advice: '引擎固件包没有按预期送达，常见于静态资源线路被限速或拦截。页面在等待较久时会提前露出备用入口；也可以直接点「换用备用星门入口」。'
    },
    'SG-02': {
      title: '通讯阵列离线',
      advice: '旗舰当前没有联网，无法同步引擎固件。连上网络后点「重新自检」。'
    },
    'SG-03': {
      title: '引擎固件无法解析',
      advice: '固件包在传输途中中断，常见于线路抖动或页面缓存过期。页面会先自动重新同步一次；仍失败请点「重新自检」，或换用备用星门入口。'
    }
  }

  function nowMs() {
    return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()
  }

  var startedAt = nowMs()
  var handedOver = false
  var failed = false
  var sending = false
  var detailText = ''
  var tickTimer = 0
  var slowTimer = 0
  var failTimer = 0
  var slowMode = false

  function byId(id) {
    return document.getElementById(id)
  }

  function setText(id, text) {
    var el = byId(id)
    if (el) el.textContent = text
  }

  function elapsedSeconds() {
    return Math.max(0, Math.round((nowMs() - startedAt) / 1000))
  }

  function setStatus(text) {
    setText('boot-status-text', text)
  }

  function setFill(percent) {
    var el = byId('boot-track-fill')
    if (el) el.style.width = percent + '%'
  }

  function clearTimers() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = 0 }
    if (slowTimer) { clearTimeout(slowTimer); slowTimer = 0 }
    if (failTimer) { clearTimeout(failTimer); failTimer = 0 }
  }

  function diagnostics(code) {
    var lines = [
      '【载入失败】自检代号 ' + code,
      '卡住工序：引擎包同步（首屏固件阶段）',
      '已等待：' + elapsedSeconds() + ' 秒',
      '平台：web',
      '地址：' + location.origin + location.pathname,
      '引擎包：' + entryScriptSrc(),
      '联网：' + (navigator.onLine ? '在线' : '离线'),
      '浏览器：' + navigator.userAgent
    ]
    if (detailText) lines.push('详情：' + detailText)
    return lines.join('\n')
  }

  function copyText(text, done) {
    var fallback = function () {
      try {
        var area = document.createElement('textarea')
        area.value = text
        area.style.position = 'fixed'
        area.style.opacity = '0'
        document.body.appendChild(area)
        area.select()
        var ok = document.execCommand('copy')
        document.body.removeChild(area)
        done(ok)
      } catch (err) {
        done(false)
      }
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { done(true) }, fallback)
        return
      }
    } catch (err) {
    }
    fallback()
  }

  function note(text) {
    setText('boot-fail-note', text)
  }

  function fallbackEntry() {
    var host = location.hostname
    if (host.slice(-10) === '.github.io') return 'https://game.bajibaji.party:7777/'
    for (var i = 0; i < SELF_HOSTS.length; i += 1) {
      if (SELF_HOSTS[i] === host) return 'https://yahzj.github.io/Deepseek-EVE/'
    }
    return null
  }

  function sendFeedback(code) {
    if (sending) return
    if (typeof fetch !== 'function') {
      note('当前浏览器过旧，无法直接上报。请点「复制诊断」把信息发给管理员。')
      return
    }
    sending = true
    note('正在提交航行日志……')
    fetch(FEEDBACK_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: diagnostics(code) + '\n\n（由载入失败页面自动提交，可在反馈里补充你遇到的情况）',
        images: [],
        meta: { version: 'web', platform: 'web', ua: navigator.userAgent, bootCode: code }
      })
    }).then(function (res) {
      return res.json().catch(function () { return {} }).then(function (payload) {
        if (!res.ok || payload.ok !== true) throw new Error(payload.message || ('HTTP ' + res.status))
        note('已提交，感谢你的报告。管理员会按自检代号 ' + code + ' 排查。')
      })
    }).catch(function (err) {
      note('提交失败：' + ((err && err.message) ? err.message : String(err)) + '。可点「复制诊断」把信息发给管理员。')
    }).then(function () {
      sending = false
    })
  }

  function fail(code, detail) {
    if (failed || handedOver) return
    failed = true
    detailText = detail || ''
    clearTimers()
    hideSlowHint()
    var splash = byId('boot-splash')
    if (splash) splash.className = 'boot-splash is-failed'
    var box = byId('boot-fail')
    if (box) box.hidden = false
    var copy = COPY[code] || COPY['SG-03']
    setText('boot-fail-title', copy.title)
    setText('boot-fail-advice', copy.advice)
    setText('boot-fail-code', '自检代号 ' + code + ' · 已等待 ' + elapsedSeconds() + ' 秒')
    var fallback = fallbackEntry()
    var link = byId('boot-fallback')
    if (link) {
      if (fallback === null) {
        link.hidden = true
      } else {
        link.hidden = false
        link.href = fallback
      }
    }
    var retry = byId('boot-retry')
    if (retry) retry.onclick = function () { location.reload() }
    var report = byId('boot-report')
    if (report) report.onclick = function () { sendFeedback(code) }
    var copyBtn = byId('boot-copy')
    if (copyBtn) copyBtn.onclick = function () {
      copyText(diagnostics(code), function (ok) {
        note(ok ? '诊断已复制，可粘贴给管理员。' : '复制失败，请截图本页。')
      })
    }
    note('把自检代号告诉管理员就能对表定位；也可以直接点「反馈问题」自动上报。')
    try { console.error('[boot] ' + code, detail || '') } catch (err) {}
  }

  function bundleReady() {
    if (failed) return
    hideSlowHint()
    clearFirmwareRetry()
    setStatus('引擎包已同步 · 正在接管舰桥……')
    setFill(20)
    if (tickTimer) { clearInterval(tickTimer); tickTimer = 0 }
    if (failTimer) { clearTimeout(failTimer); failTimer = 0 }
  }

  function handover() {
    handedOver = true
    hideSlowHint()
    clearFirmwareRetry()
    clearTimers()
  }

  var FW_RETRY_KEY = 'whale:boot:fw-retry'
  var retrying = false
  var probing = false

  function clearFirmwareRetry() {
    try { sessionStorage.removeItem(FW_RETRY_KEY) } catch (err) {}
  }

  function reloadWithFreshFirmware() {
    try {
      var url = new URL(location.href)
      url.searchParams.set('_fw', String(Date.now()))
      location.replace(url.toString())
    } catch (err) {
      location.reload()
    }
  }

  function scriptSourceOf(target) {
    if (!target) return ''
    return target.src || target.getAttribute('src') || ''
  }

  function entryScriptSrc() {
    var entry = document.querySelector('script[type="module"]')
    return entry && entry.src ? entry.src : '未找到模块入口'
  }

  function hideSlowHint() {
    var hint = byId('boot-slow-hint')
    if (hint) hint.hidden = true
  }

  function describeLoadFailure(src) {
    if (!src) {
      fail('SG-03', '引擎包脚本加载失败')
      return
    }
    var name = src.replace(/[?#].*$/, '').replace(/^.*\//, '')
    function done(extra) {
      fail('SG-03', '引擎包脚本加载失败（' + name + '，' + extra + '，已自动重新同步 1 次）')
    }
    try {
      fetch(src, { method: 'HEAD', cache: 'no-store' }).then(function (res) {
        done('HTTP ' + res.status)
      }).catch(function () {
        done('请求被线路阻断')
      })
    } catch (err) {
      done('请求被线路阻断')
    }
  }

  function handleScriptFailure(target) {
    if (handedOver || failed) return
    var src = scriptSourceOf(target)
    var tried = false
    try { tried = sessionStorage.getItem(FW_RETRY_KEY) === '1' } catch (err) {}
    if (!tried && !retrying) {
      retrying = true
      try { sessionStorage.setItem(FW_RETRY_KEY, '1') } catch (err) {}
      setStatus('引擎包不完整 · 正在重新同步固件……')
      setFill(0)
      reloadWithFreshFirmware()
      return
    }
    if (probing) return
    probing = true
    describeLoadFailure(src)
  }

  window.__WHALE_BOOT__ = {
    startedAt: startedAt,
    bundleReady: bundleReady,
    handover: handover,
    fail: function (code, detail) { fail(code, detail) }
  }

  if (!(typeof HTMLScriptElement !== 'undefined' && 'noModule' in HTMLScriptElement.prototype)) {
    fail('SG-03', '浏览器不支持模块脚本')
    return
  }
  if (navigator.onLine === false) {
    fail('SG-02')
    return
  }

  window.addEventListener('offline', function () {
    if (!handedOver) fail('SG-02')
  })
  window.addEventListener('error', function (event) {
    if (handedOver) return
    var target = event.target
    if (target && target.tagName === 'SCRIPT') {
      handleScriptFailure(target)
      return
    }
    if (!failed) fail('SG-03', event.message || '')
  }, true)
  window.addEventListener('unhandledrejection', function () {
    if (!handedOver && !failed) fail('SG-03', '脚本执行异常')
  })

  function syncStatus() {
    if (handedOver || failed) return
    setStatus(
      slowMode
        ? '星门同步链路较慢 · 已等待 ' + elapsedSeconds() + ' 秒，仍在校验固件……可点下方备用入口'
        : '正在启动星门引擎 · 已等待 ' + elapsedSeconds() + ' 秒',
    )
  }

  tickTimer = setInterval(syncStatus, 1000)
  slowTimer = setTimeout(function () {
    if (handedOver || failed) return
    slowMode = true
    syncStatus()
    var hint = byId('boot-slow-hint')
    var slowLink = byId('boot-slow-fallback')
    var fallback = fallbackEntry()
    if (hint) hint.hidden = false
    if (slowLink && fallback) {
      slowLink.hidden = false
      slowLink.href = fallback
    }
  }, SLOW_MS)
  failTimer = setTimeout(function () {
    if (!handedOver && !failed) fail('SG-01')
  }, FAIL_MS)
})()
