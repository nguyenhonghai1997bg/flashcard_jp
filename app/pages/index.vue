<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRequestURL, useRuntimeConfig } from '#app'

type WordItem = {
  id: number
  lesson_id: number
  kanji?: string
  hira?: string
  mean?: string
  mean_unsigned?: string
  text?: string
  example?: string
}

type GrammarItem = {
  id: number
  lesson_id: number
  title: string
  content: string
}

type ListenItem = {
  id: number
  lesson_id: number
  text: string
  audios?: string
}

type LessonItem = {
  id: number
  title: string
  book_id?: number
}

type BookItem = {
  id: number
  title: string
}

type StudyRecord = {
  id: number
  lessonId: number
  title: string
  subtitle: string
  meaning: string
  detailHtml: string
  source: 'word' | 'grammar' | 'listen'
}

const { app: { baseURL } } = useRuntimeConfig()
const requestUrl = useRequestURL()

const publicJsonPath = (fileName: string) => {
  const normalizedBase = baseURL.endsWith('/') ? baseURL : `${baseURL}/`
  const origin = import.meta.client ? window.location.origin : requestUrl.origin
  return new URL(`${normalizedBase}db_mimikara/${fileName}`, origin).toString()
}

const loadError = ref<Error | null>(null)

const [
  wordsData,
  grammarData,
  listenData,
  lessonsData,
  listenLessonsData,
  booksData
] = await Promise.all([
  $fetch<WordItem[]>(publicJsonPath('word.json')).catch((e) => {
    loadError.value = e as Error
    return []
  }),
  $fetch<GrammarItem[]>(publicJsonPath('grammar.json')).catch((e) => {
    loadError.value = e as Error
    return []
  }),
  $fetch<ListenItem[]>(publicJsonPath('listen.json')).catch((e) => {
    loadError.value = e as Error
    return []
  }),
  $fetch<LessonItem[]>(publicJsonPath('lesson.json')).catch((e) => {
    loadError.value = e as Error
    return []
  }),
  $fetch<LessonItem[]>(publicJsonPath('lesson_listen.json')).catch((e) => {
    loadError.value = e as Error
    return []
  }),
  $fetch<BookItem[]>(publicJsonPath('book.json')).catch((e) => {
    loadError.value = e as Error
    return []
  })
])

const words = computed(() => wordsData ?? [])
const grammar = computed(() => grammarData ?? [])
const listen = computed(() => listenData ?? [])
const lessons = computed(() => lessonsData ?? [])
const listenLessons = computed(() => listenLessonsData ?? [])
const books = computed(() => booksData ?? [])

const pending = computed(() => false)
const error = computed(() => loadError.value)

const mode = ref<'flashcard' | 'list'>('flashcard')
const source = ref<'word' | 'grammar' | 'listen'>('word')
const query = ref('')
const selectedBook = ref<number | 'all'>(2)
const selectedLesson = ref<number | 'all'>('all')
const cardIndex = ref(0)
const showAnswer = ref(false)
const showHiragana = ref(true)
const showFilters = ref(false)
const touchStartX = ref(0)
const touchStartY = ref(0)
const suppressNextTap = ref(false)

const normalizeText = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim()

const stripHtml = (value?: string) => (value ?? '')
  .replace(/<[^>]*>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const formatDetailHtml = (value?: string) => (value ?? '')
  .replace(/(?:<br\s*\/?>(\s)*)?※/g, '<br/>※')
  .replace(/^<br\s*\/?>/i, '')

const sourceLabelMap: Record<'word' | 'grammar' | 'listen', string> = {
  word: 'Từ vựng',
  grammar: 'Ngữ pháp',
  listen: 'Luyện nghe'
}

const lessonMap = computed(() => {
  const map = new Map<number, string>()
  for (const lesson of lessons.value) {
    map.set(lesson.id, lesson.title)
  }
  return map
})

const listenLessonMap = computed(() => {
  const map = new Map<number, string>()
  for (const lesson of listenLessons.value) {
    map.set(lesson.id, lesson.title)
  }
  return map
})

const bookMap = computed(() => {
  const map = new Map<number, string>()
  for (const book of books.value) {
    map.set(book.id, book.title)
  }
  return map
})

const records = computed<StudyRecord[]>(() => {
  if (source.value === 'word') {
    return words.value.map((item) => {
      const [jpExample, vnExample] = (item.example ?? '').split('*')
      return {
        id: item.id,
        lessonId: item.lesson_id,
        title: item.kanji || stripHtml(item.text) || '---',
        subtitle: item.hira ?? '',
        meaning: item.mean ?? '',
        detailHtml: [jpExample?.trim(), vnExample?.trim()].filter(Boolean).join('<br/>'),
        source: 'word'
      }
    })
  }

  if (source.value === 'grammar') {
    return grammar.value.map((item) => {
      const summary = stripHtml(item.content).slice(0, 220)
      return {
        id: item.id,
        lessonId: item.lesson_id,
        title: item.title,
        subtitle: 'Mẫu ngữ pháp',
        meaning: summary,
        detailHtml: item.content,
        source: 'grammar'
      }
    })
  }

  return listen.value.map((item) => {
    const plain = stripHtml(item.text)
    return {
      id: item.id,
      lessonId: item.lesson_id,
      title: plain.slice(0, 80) || `Bài nghe ${item.id}`,
      subtitle: `Audio: ${item.audios ?? '-'}`,
      meaning: plain.slice(0, 220),
      detailHtml: item.text,
      source: 'listen'
    }
  })
})

const lessonOptions = computed(() => {
  if (source.value === 'listen') {
    return listenLessons.value
  }
  return lessons.value
})

const filteredLessonOptions = computed(() => {
  if (selectedBook.value === 'all') {
    return lessonOptions.value
  }

  return lessonOptions.value.filter((item) => item.book_id === selectedBook.value)
})

const lessonBookMap = computed(() => {
  const map = new Map<number, number | undefined>()
  for (const lesson of lessonOptions.value) {
    map.set(lesson.id, lesson.book_id)
  }
  return map
})

const getLessonTitle = (lessonId: number) => {
  if (source.value === 'listen') {
    return listenLessonMap.value.get(lessonId) ?? `Lesson ${lessonId}`
  }
  return lessonMap.value.get(lessonId) ?? `Lesson ${lessonId}`
}

const filteredRecords = computed(() => {
  const list = records.value
  const q = normalizeText(query.value)

  return list.filter((item) => {
    const bookMatched = selectedBook.value === 'all' || lessonBookMap.value.get(item.lessonId) === selectedBook.value
    if (!bookMatched) return false

    const lessonMatched = selectedLesson.value === 'all' || item.lessonId === selectedLesson.value
    if (!lessonMatched) return false
    if (!q) return true

    const searchable = [
      item.title,
      item.subtitle,
      item.meaning,
      stripHtml(item.detailHtml)
    ]
      .filter(Boolean)
      .map((part) => normalizeText(String(part)))
      .join(' ')

    return searchable.includes(q)
  })
})

const currentCard = computed(() => {
  const list = filteredRecords.value
  if (!list.length) return null

  const safeIndex = Math.min(cardIndex.value, list.length - 1)
  if (safeIndex !== cardIndex.value) {
    cardIndex.value = safeIndex
  }

  return list[safeIndex]
})

const currentLessonTitle = computed(() => {
  if (!currentCard.value) return ''
  return getLessonTitle(currentCard.value.lessonId)
})

const currentBookTitle = computed(() => {
  if (!currentCard.value) return ''

  const lesson = lessonOptions.value.find((item) => item.id === currentCard.value?.lessonId)
  if (!lesson?.book_id) return ''

  return bookMap.value.get(lesson.book_id) ?? `Book ${lesson.book_id}`
})

const cardProgressText = computed(() => {
  const total = filteredRecords.value.length
  if (!total) return '0/0'
  return `${cardIndex.value + 1}/${total}`
})

const moveCard = (step: number) => {
  const length = filteredRecords.value.length
  if (!length) return

  showAnswer.value = false
  cardIndex.value = (cardIndex.value + step + length) % length
}

const randomCard = () => {
  const length = filteredRecords.value.length
  if (!length) return
  showAnswer.value = false
  cardIndex.value = Math.floor(Math.random() * length)
}

const onCardTap = () => {
  if (suppressNextTap.value) {
    suppressNextTap.value = false
    return
  }
  showAnswer.value = !showAnswer.value
}

const onCardTouchStart = (event: TouchEvent) => {
  const touch = event.changedTouches[0]
  if (!touch) return
  touchStartX.value = touch.clientX
  touchStartY.value = touch.clientY
}

const onCardTouchEnd = (event: TouchEvent) => {
  const touch = event.changedTouches[0]
  if (!touch) return
  const deltaX = touch.clientX - touchStartX.value
  const deltaY = touch.clientY - touchStartY.value

  // Horizontal swipe should be dominant to avoid conflict with vertical scrolling.
  if (Math.abs(deltaX) > 45 && Math.abs(deltaY) < 35) {
    suppressNextTap.value = true
    moveCard(deltaX > 0 ? -1 : 1)
  }
}

const onKeydown = (event: KeyboardEvent) => {
  if (mode.value !== 'flashcard' || !currentCard.value) return

  const target = event.target as HTMLElement | null
  if (target) {
    const tag = target.tagName.toLowerCase()
    const isEditable = target.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select'
    if (isEditable) return
  }

  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    moveCard(-1)
    return
  }

  if (event.key === 'ArrowRight') {
    event.preventDefault()
    moveCard(1)
    return
  }

  if (event.key === ' ' || event.code === 'Space') {
    event.preventDefault()
    showAnswer.value = !showAnswer.value
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})

const activeBookCount = computed(() => {
  const ids = new Set(lessonOptions.value.map((item) => Math.floor(item.id / 1000)))
  return ids.size || books.value.length
})

watch([query, selectedLesson, selectedBook, source], () => {
  cardIndex.value = 0
  showAnswer.value = false

  if (selectedLesson.value !== 'all') {
    const hasLesson = filteredLessonOptions.value.some((item) => item.id === selectedLesson.value)
    if (!hasLesson) {
      selectedLesson.value = 'all'
    }
  }
})
</script>

<template>
  <main class="min-h-screen bg-gradient-to-br from-amber-50 via-cyan-50 to-orange-50 px-4 py-8 text-slate-800 md:px-8">
    <section class="mx-auto mb-4 w-full max-w-6xl">
      <p class="inline-flex rounded-full bg-teal-900 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-white">
        日本語がんばろう
      </p>
      <h1 class="mt-3 text-3xl font-extrabold text-slate-900 md:text-5xl">
        Flashcard Nhật - Việt
      </h1>
      <!-- <p class="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600 md:text-base">
        public/db_mimikara のJSONを直接読み込み。Từ vựng・Ngữ pháp・Luyện nghe を1画面で検索/一覧/フラッシュカード学習できます。
      </p> -->
    </section>

    <section class="mx-auto mb-4 w-full max-w-6xl rounded-3xl border border-slate-200/70 bg-white/80 p-4 shadow-xl shadow-slate-200/50 backdrop-blur">
      <div class="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <label for="search" class="mb-2 block text-sm font-bold text-slate-700">Tìm kiếm Nhật / Việt</label>
          <input
            id="search"
            v-model="query"
            type="text"
            class="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-200"
            placeholder="Ví dụ: じょせい, phụ nữ, tuổi cao..."
          >
        </div>
        <button
          class="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          @click="showFilters = !showFilters"
        >
          {{ showFilters ? 'Thu gọn bộ lọc' : 'Mở rộng bộ lọc' }}
        </button>
      </div>

      <div v-show="showFilters" class="mt-4 grid gap-4 md:grid-cols-3">
      <!-- <div>
        <label for="source" class="mb-2 block text-sm font-bold text-slate-700">Loại dữ liệu</label>
        <select
          id="source"
          v-model="source"
          class="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-200"
        >
          <option value="word">Từ vựng</option>
          <option value="grammar">Ngữ pháp</option>
          <option value="listen">Luyện nghe</option>
        </select>
      </div> -->

      <div>
        <label for="book" class="mb-2 block text-sm font-bold text-slate-700">Lọc theo book</label>
        <select
          id="book"
          v-model="selectedBook"
          class="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-200"
        >
          <option value="all">Tất cả book</option>
          <option
            v-for="book in books"
            :key="book.id"
            :value="book.id"
          >
            {{ book.title }}
          </option>
        </select>
      </div>

      <div>
        <label for="lesson" class="mb-2 block text-sm font-bold text-slate-700">Lọc theo bài</label>
        <select
          id="lesson"
          v-model="selectedLesson"
          class="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-200"
        >
          <option value="all">Tất cả bài</option>
          <option
            v-for="lesson in filteredLessonOptions"
            :key="lesson.id"
            :value="lesson.id"
          >
            {{ lesson.title }}
          </option>
        </select>
      </div>

      <div class="flex items-end gap-2">
        <button
          class="rounded-xl border px-4 py-2 text-sm font-semibold transition"
          :class="mode === 'flashcard' ? 'border-teal-600 bg-teal-600 text-white' : 'border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100'"
          @click="mode = 'flashcard'"
        >
          Flashcard
        </button>
        <button
          class="rounded-xl border px-4 py-2 text-sm font-semibold transition"
          :class="mode === 'list' ? 'border-teal-600 bg-teal-600 text-white' : 'border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100'"
          @click="mode = 'list'"
        >
          Danh sách
        </button>
      </div>
      </div>
    </section>

    <section class="mx-auto mb-4 w-full max-w-6xl rounded-2xl border border-slate-200 bg-white/70 px-4 py-3 text-sm text-slate-700">
      <p v-if="pending">Đang tải dữ liệu...</p>
      <p v-else-if="error">Không tải được dữ liệu. Vui lòng kiểm tra lại tệp JSON.</p>
      <p v-else class="flex flex-wrap items-center gap-2">
        <span class="rounded-full bg-teal-50 px-3 py-1 font-semibold text-teal-700">{{ sourceLabelMap[source] }}</span>
        <span>Tìm thấy <strong>{{ filteredRecords.length }}</strong> mục.</span>
        <!-- <span class="text-slate-400">|</span> -->
      </p>
    </section>

    <section
      v-if="!pending && !error && mode === 'flashcard'"
      class="mx-auto w-full max-w-6xl rounded-3xl border border-slate-200/70 bg-white/85 p-4 shadow-xl shadow-slate-200/40"
    >
      <div v-if="currentCard" class="space-y-3">
        <div class="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-center gap-2 text-xs font-medium text-slate-700">
          <span v-if="currentBookTitle" class="rounded-full border border-slate-300 bg-white px-2.5 py-0.5">{{ currentBookTitle }}</span>
          <span class="rounded-full border border-slate-300 bg-white px-2.5 py-0.5">{{ currentLessonTitle }}</span>
        </div>

        <div class="flex justify-center">
          <div
            class="relative w-full max-w-3xl cursor-pointer rounded-2xl bg-gradient-to-br from-teal-700 via-cyan-600 to-teal-500 px-6 py-8 text-center text-white transition hover:-translate-y-0.5"
            @click="onCardTap"
            @touchstart="onCardTouchStart"
            @touchend="onCardTouchEnd"
          >
            <p class="absolute right-4 top-4 rounded-full bg-white/20 px-3 py-1 text-xs font-bold text-white">
              {{ cardProgressText }}
            </p>
            <p class="mt-1 text-xs text-cyan-100/90">{{ showAnswer ? 'Mặt sau' : 'Mặt trước' }} - bấm để lật, vuốt trái/phải để đổi thẻ</p>

            <template v-if="!showAnswer">
              <p class="mt-6 text-3xl font-extrabold leading-tight md:text-5xl">{{ currentCard.title }}</p>
              <p v-if="showHiragana" class="mt-3 text-base text-cyan-50">{{ currentCard.subtitle }}</p>
            </template>

            <template v-else>
              <p class="mt-6 text-lg font-bold text-amber-100 md:text-2xl">{{ currentCard.meaning }}</p>
              <div
                v-if="currentCard.detailHtml"
                class="prose prose-invert prose-sm mt-4 max-w-none rounded-xl bg-white/10 p-3 text-left"
                v-html="formatDetailHtml(currentCard.detailHtml)"
              />
            </template>
          </div>
        </div>
      </div>

      <div v-else class="rounded-2xl border border-dashed border-slate-300 px-4 py-10 text-center text-slate-500">
        Không có dữ liệu phù hợp với bộ lọc hiện tại.
      </div>

      <div class="mt-4 flex flex-wrap justify-center gap-2">
        <button
          class="rounded-xl bg-slate-700 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          @click="showHiragana = !showHiragana"
        >
          {{ showHiragana ? 'Ẩn Hiragana' : 'Hiện Hiragana' }}
        </button>
        <button class="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600" @click="randomCard">
          Ngẫu nhiên
        </button>
      </div>
    </section>

    <section
      v-if="!pending && !error && mode === 'list'"
      class="mx-auto w-full max-w-6xl rounded-3xl border border-slate-200/70 bg-white/85 p-4 shadow-xl shadow-slate-200/40"
    >
      <div v-if="filteredRecords.length" class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        <article
          v-for="item in filteredRecords"
          :key="item.id"
          class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <p class="text-xs font-semibold text-slate-500">{{ getLessonTitle(item.lessonId) }}</p>
          <h3 class="mt-2 text-xl font-extrabold text-slate-900">{{ item.title }}</h3>
          <p class="mt-1 text-sm text-slate-600">{{ item.subtitle }}</p>
          <p class="mt-3 text-sm leading-relaxed text-slate-700">{{ item.meaning }}</p>
        </article>
      </div>

      <div v-else class="rounded-2xl border border-dashed border-slate-300 px-4 py-10 text-center text-slate-500">
        Không tìm thấy mục từ nào.
      </div>
    </section>
  </main>
</template>
