import fs from 'node:fs/promises'
import path from 'node:path'

const BASE_URL = 'https://www.vnjpclub.com/somatome-n2-han-tu'
const MARKER = '[SOMATOME_N2_KANJI]'
const BOOK_TITLE = 'Somatome N2 - Hán tự'
const YKHP_REPLACEMENTS = [
  ['@', 'CAg'],
  ['!', 'W5'],
  ['*', 'CAgI'],
  ['$', 'dGhl'],
  ['%', 'YXN'],
  ['&', 'YW']
]

const repoRoot = process.cwd()
const dbDir = path.join(repoRoot, 'public', 'db_mimikara')
const bookPath = path.join(dbDir, 'book.json')
const lessonPath = path.join(dbDir, 'lesson.json')
const wordPath = path.join(dbDir, 'word.json')

const normalizeWhitespace = (value) => value.replace(/\s+/g, ' ').trim()

const stripTags = (value) => {
  const withLineBreaks = value
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<\/?(p|div|tr|td|th|span|strong|b|i|u|em|thead|tbody|table)[^>]*>/gi, ' ')

  return normalizeWhitespace(
    decodeHtmlEntities(withLineBreaks.replace(/<[^>]*>/g, ' '))
  )
}

const decodeHtmlEntities = (value) => value
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;/gi, "'")
  .replace(/&#x2F;/gi, '/')
  .replace(/&#47;/gi, '/')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')

const removeVietnameseDiacritics = (value) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/g, 'd')
  .replace(/Đ/g, 'D')
  .toLowerCase()
  .trim()

const toRubyText = (kanji, hira) => {
  if (!kanji && !hira) return ''
  if (!hira) return kanji
  return `<ruby>${kanji}<rp>（</rp><rt>${hira}</rt><rp>）</rp></ruby>`
}

const lessonTitle = (week, day) => `Somatome N2 Hán tự - Tuần ${week} Bài ${day}`

const parseWeekDayFromUrl = (url) => {
  const matched = url.match(/\/tuan-(\d+)(?:-(\d+))?\.html$/i)
  if (!matched) return null

  const week = Number(matched[1])
  const day = matched[2] ? Number(matched[2]) : 1
  if (!Number.isInteger(week) || !Number.isInteger(day)) return null

  return { week, day }
}

const extractLessonLinksFromIndex = (indexHtml) => {
  const articleMatches = indexHtml.match(/<article[\s\S]*?<\/article>/gi) ?? []
  const links = new Set()

  for (const articleHtml of articleMatches) {
    const anchorMatches = articleHtml.match(/<a[^>]+href=["'][^"']+["'][^>]*>/gi) ?? []
    for (const anchor of anchorMatches) {
      const hrefMatch = anchor.match(/href=["']([^"']+)["']/i)
      if (!hrefMatch) continue

      const href = decodeHtmlEntities(hrefMatch[1]).trim()
      if (!href) continue

      const absolute = href.startsWith('http')
        ? href
        : new URL(href, `${BASE_URL}/`).toString()

      if (!/\/somatome-n2-han-tu\/tuan-\d+(?:-\d+)?\.html$/i.test(absolute)) continue
      links.add(absolute)
    }
  }

  return [...links]
    .map((url) => ({ url, parsed: parseWeekDayFromUrl(url) }))
    .filter((item) => item.parsed && item.parsed.week >= 1 && item.parsed.week <= 8 && item.parsed.day >= 1 && item.parsed.day <= 7)
    .sort((a, b) => (a.parsed.week - b.parsed.week) || (a.parsed.day - b.parsed.day))
}

const extractTableHtml = (html) => {
  const allTables = html.match(/<table[\s\S]*?<\/table>/gi) ?? []
  if (!allTables.length) {
    return ''
  }

  const normalizedTables = allTables
    .map((tableHtml) => decodeHtmlEntities(tableHtml))

  const preferred = normalizedTables.find((tableHtml) =>
    /Chữ\s*Hán|Âm\s*Hán\s*Việt|Phát\s*âm|Nghĩa/i.test(tableHtml)
  )

  if (preferred) {
    return preferred
  }

  const khung = normalizedTables.find((tableHtml) => /class=["'][^"']*khung[^"']*["']/i.test(tableHtml))
  return khung ?? ''
}

const extractRowsFromKhungTable = (html) => {
  const tableHtml = extractTableHtml(html)
  if (!tableHtml) {
    return []
  }

  const rowMatches = tableHtml.match(/<tr[\s\S]*?<\/tr>/gi) ?? []
  const rows = []

  for (const rowHtml of rowMatches) {
    if (/<th[\s\S]*?<\/th>/i.test(rowHtml)) continue

    const cellMatches = rowHtml.match(/<td[\s\S]*?<\/td>/gi) ?? []
    if (cellMatches.length < 4) continue

    const [kanjiRaw, hanvietRaw, hiraRaw, meanRaw] = cellMatches
    const kanji = stripTags(kanjiRaw)
    const hanviet = stripTags(hanvietRaw)
    const hira = stripTags(hiraRaw)
    const mean = stripTags(meanRaw)

    if (!kanji && !hira && !mean) continue

    rows.push({ kanji, hanviet, hira, mean })
  }

  return rows
}

const decodeProtectedHtml = (pageHtml) => {
  const match = pageHtml.match(/data-ykhp="([^"]+)"/i)
  if (!match) {
    return ''
  }

  let candidate = decodeHtmlEntities(match[1])
  for (const [from, to] of YKHP_REPLACEMENTS) {
    candidate = candidate.split(from).join(to)
  }

  try {
    const decoded = Buffer.from(candidate, 'base64').toString('utf8')
    if (decoded.includes('<table') && (decoded.includes('Chữ') || decoded.includes('漢字'))) {
      return decoded
    }
  } catch {
    return ''
  }

  return ''
}

const fetchHtml = async (url) => {
  try {
    const res = await fetch(url)
    if (!res.ok) return null

    const html = await res.text()
    if (!html) return null

    return { url, html }
  } catch {
    return null
  }
}

const fetchLessonPage = async (url) => {
  const page = await fetchHtml(url)
  if (!page) return null
  if (!page.html.includes('<table') && !page.html.includes('data-ykhp=')) return null
  return page
}

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, 'utf8'))

const writeJson = async (filePath, data) => {
  const content = `${JSON.stringify(data, null, 4)}\n`
  await fs.writeFile(filePath, content, 'utf8')
}

const main = async () => {
  const [booksRaw, lessonsRaw, wordsRaw] = await Promise.all([
    readJson(bookPath),
    readJson(lessonPath),
    readJson(wordPath)
  ])

  const books = [...booksRaw]
  let lessons = lessonsRaw.filter((item) => !String(item.title ?? '').startsWith('Somatome N2 Hán tự -'))
  let words = wordsRaw.filter((item) => !String(item.more ?? '').startsWith(MARKER))

  let book = books.find((item) => item.title === BOOK_TITLE)
  if (!book) {
    const nextBookId = books.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1
    book = { id: nextBookId, selected: 0, title: BOOK_TITLE }
    books.push(book)
  }

  const nextLessonIdBase = lessons.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0)
  let nextLessonId = nextLessonIdBase + 1

  const nextWordIdBase = words.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0)
  let nextWordId = nextWordIdBase + 1

  const importedLessons = []
  const importedWords = []
  const missingPages = []

  const indexPage = await fetchHtml(`${BASE_URL}/`)
  if (!indexPage) {
    throw new Error('Không tải được trang mục lục Somatome N2 Hán tự.')
  }

  const lessonLinks = extractLessonLinksFromIndex(indexPage.html)
  if (!lessonLinks.length) {
    throw new Error('Không tìm thấy link bài trong thẻ a bên trong article.')
  }

  for (const { url, parsed } of lessonLinks) {
    const page = await fetchLessonPage(url)
    if (!page) {
      missingPages.push(url)
      continue
    }

    const { week, day } = parsed
    const protectedHtml = decodeProtectedHtml(page.html)
    const parseSource = protectedHtml || page.html
    const rows = extractRowsFromKhungTable(parseSource)
    if (!rows.length) {
      missingPages.push(page.url)
      continue
    }

    const lesson = {
      id: nextLessonId,
      book_id: book.id,
      audio: 0,
      title: lessonTitle(week, day)
    }
    nextLessonId += 1
    importedLessons.push(lesson)

    let rowNum = 1
    for (const row of rows) {
      const word = {
        id: nextWordId,
        lesson_id: lesson.id,
        kanji: row.kanji,
        hira: row.hira,
        mean: row.mean,
        mean_unsigned: removeVietnameseDiacritics(row.mean),
        cn_mean: row.hanviet,
        cn_mean_unsigned: removeVietnameseDiacritics(row.hanviet),
        text: toRubyText(row.kanji, row.hira),
        example: '',
        more: `${MARKER}|url=${page.url}|week=${week}|day=${day}|row=${rowNum}`,
        audio: '',
        favorite: 0,
        num: 0,
        score: 0,
        t_number: 0,
        time_access: 0,
        time_answer: 0
      }
      nextWordId += 1
      rowNum += 1
      importedWords.push(word)
    }
  }

  lessons = [...lessons, ...importedLessons]
  words = [...words, ...importedWords]

  await Promise.all([
    writeJson(bookPath, books),
    writeJson(lessonPath, lessons),
    writeJson(wordPath, words)
  ])

  const report = {
    discoveredLinks: lessonLinks.length,
    importedLessons: importedLessons.length,
    importedWords: importedWords.length,
    missingPages,
    bookId: book.id
  }

  console.log(JSON.stringify(report, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
