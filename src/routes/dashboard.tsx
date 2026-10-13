import { createFileRoute, Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useDecks } from "@/lib/decks";
import { SiteHeader } from "@/components/SiteHeader";
import { LegalLinks } from "@/components/LegalLinks";
import { StreakCard } from "@/components/StreakCard";
import { ReviewForecastCard } from "@/components/ReviewForecastCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  generateDeckWithAI,
  getTranslations,
  generateDeckFromUrl,
  importManualCardsFromImage,
  importManualCardsFromText,
} from "@/lib/ai.functions";
import {
  Plus,
  Trash2,
  BookOpen,
  Sparkles,
  Loader2,
  Check,
  X,
  Link2,
  LayoutGrid,
  Globe2,
  Search,
  FileText,
  Upload,
  FileSpreadsheet,
} from "lucide-react";
import { useT } from "@/lib/i18n";
import { CSV_MAX_FILE_BYTES, deckNameFromFileName, parseDeckCsv } from "@/lib/deck-csv";
import { useLastStudied } from "@/lib/last-studied";
import { useCollections } from "@/lib/collections";
import { DeckColorPicker } from "@/components/DeckColorPicker";
import { getDeckColorOption, type DeckCoverColor } from "@/lib/deck-colors";
import {
  getDefinitionLanguageFor,
  getLearningLanguageOption,
  LEARNING_LANGUAGE_OPTIONS,
  type LearningLanguage,
} from "@/lib/languages";
import {
  loadDeckLanguagePreference,
  saveDeckLanguagePreference,
} from "@/lib/deck-language-preference";
import { getUserErrorMessage } from "@/lib/user-errors";
import { shrinkImageToFit } from "@/lib/image-resize";
import { OFFLINE_AI_MESSAGE, OFFLINE_SAVE_MESSAGE, useOnlineStatus } from "@/lib/online-status";
import { cn } from "@/lib/utils";
import { createAiIdempotencyKey, executeAiRequest } from "@/lib/ai-client";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Flashlark — learn vocabulary" },
      {
        name: "description",
        content: "Create your own decks and study vocabulary with flashcards.",
      },
    ],
  }),
  component: Home,
});

function plural(n: number, forms: [string, string, string]) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
  return forms[2];
}

function errorMessage(error: unknown, fallback: string) {
  return getUserErrorMessage(error, fallback);
}

const MIN_DECK_CARDS = 4;
const MAX_DECK_CARDS = 100;
const MAX_IMPORT_IMAGE_BYTES = 2_500_000;
const SUPPORTED_IMPORT_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

type ManualCardDraft = { term: string; definition: string };
type ImportImageMimeType = (typeof SUPPORTED_IMPORT_IMAGE_TYPES)[number];
type PendingCreation = { fingerprint: string; idempotencyKey: string };

function stableCreationKey(requestRef: { current: PendingCreation | null }, fingerprint: string) {
  if (requestRef.current?.fingerprint !== fingerprint) {
    requestRef.current = { fingerprint, idempotencyKey: createAiIdempotencyKey() };
  }
  return requestRef.current.idempotencyKey;
}

function clampCardCount(value: string, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Could not read this image."));
    reader.readAsDataURL(file);
  });
}

function isSupportedImportImageType(type: string): type is ImportImageMimeType {
  return SUPPORTED_IMPORT_IMAGE_TYPES.includes(type as ImportImageMimeType);
}

function Home() {
  const { decks, createDeckWithCards, deleteDeck, isCreatingDeck } = useDecks();
  const navigate = useNavigate();
  const { collections } = useCollections();
  const [collectionId, setCollectionId] = useState<string>("__default__");
  const [targetLanguage, setTargetLanguage] = useState<LearningLanguage>("en");
  const [definitionLanguageCode, setDefinitionLanguageCode] = useState<LearningLanguage>("ru");
  const learningLanguage = getLearningLanguageOption(targetLanguage);
  const definitionLanguage = getLearningLanguageOption(definitionLanguageCode);
  const selectedCollectionId = collectionId === "__default__" ? null : collectionId;
  const COLLECTIONS_PAGE_SIZE = 3;
  const [collectionPage, setCollectionPage] = useState(0);
  const extraCollections = collections.filter((c) => c.name !== "My collection");
  const totalCollectionPages = Math.max(
    1,
    Math.ceil(extraCollections.length / COLLECTIONS_PAGE_SIZE),
  );
  const safeCollectionPage = Math.min(collectionPage, totalCollectionPages - 1);
  const pagedCollections = extraCollections.slice(
    safeCollectionPage * COLLECTIONS_PAGE_SIZE,
    safeCollectionPage * COLLECTIONS_PAGE_SIZE + COLLECTIONS_PAGE_SIZE,
  );
  const lastStudied = useLastStudied();
  const location = useLocation();
  const query = new URLSearchParams(location.search).get("search") || "";
  const sortedDecks = [...decks].sort((a, b) => {
    const la = lastStudied[a.id] ?? 0;
    const lb = lastStudied[b.id] ?? 0;
    if (lb !== la) return lb - la;
    return b.createdAt - a.createdAt;
  });
  const filteredDecks = query
    ? sortedDecks.filter((d) => d.name.toLowerCase().includes(query.toLowerCase()))
    : sortedDecks;
  const visibleDecks = query ? filteredDecks : filteredDecks.slice(0, 6);
  const hasMore = !query && filteredDecks.length > 6;
  const t = useT();
  const isOnline = useOnlineStatus();
  const [open, setOpen] = useState(false);
  const [deleteDeckId, setDeleteDeckId] = useState<string | null>(null);
  const [deckColor, setDeckColor] = useState<DeckCoverColor | null>(null);
  const deckToDelete = decks.find((d) => d.id === deleteDeckId);
  const imageImportInputRef = useRef<HTMLInputElement | null>(null);
  const csvImportInputRef = useRef<HTMLInputElement | null>(null);
  const manualCreationRef = useRef<PendingCreation | null>(null);
  const aiCreationRef = useRef<PendingCreation | null>(null);
  const urlCreationRef = useRef<PendingCreation | null>(null);

  // Manual creation state
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [manualCards, setManualCards] = useState<ManualCardDraft[]>([]);
  // Imports finish after an await; read the latest cards through a ref so
  // edits made while an import was running are not overwritten.
  const manualCardsRef = useRef(manualCards);
  manualCardsRef.current = manualCards;
  const [wordInput, setWordInput] = useState("");
  const [definitionInput, setDefinitionInput] = useState("");
  const [importText, setImportText] = useState("");
  const [importMode, setImportMode] = useState<"text" | "image" | null>(null);
  const [importError, setImportError] = useState("");
  const [importImageName, setImportImageName] = useState("");
  const [trLoading, setTrLoading] = useState(false);
  const [trError, setTrError] = useState("");
  const [manualError, setManualError] = useState("");
  const [trWord, setTrWord] = useState("");
  const [trOriginalWord, setTrOriginalWord] = useState("");
  const [trDirection, setTrDirection] = useState("");
  const [trInputIsDefinition, setTrInputIsDefinition] = useState(false);
  const [trOptions, setTrOptions] = useState<string[]>([]);
  const fetchTranslations = useServerFn(getTranslations);
  const importCardsFromText = useServerFn(importManualCardsFromText);
  const importCardsFromImage = useServerFn(importManualCardsFromImage);

  // AI generation state
  const [aiName, setAiName] = useState("");
  const [aiTopic, setAiTopic] = useState("");
  const [aiDesc, setAiDesc] = useState("");
  const [aiLevel, setAiLevel] = useState("B1");
  const [aiCount, setAiCount] = useState("10");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const genDeck = useServerFn(generateDeckWithAI);
  const aiGeneratedRef = useRef<{
    fingerprint: string;
    result: Awaited<ReturnType<typeof genDeck>>;
  } | null>(null);

  // URL-based generation state
  const [urlInput, setUrlInput] = useState("");
  const [urlDesc, setUrlDesc] = useState("");
  const [urlCount, setUrlCount] = useState("15");
  const [urlLoading, setUrlLoading] = useState(false);
  const [urlError, setUrlError] = useState("");
  const genDeckFromUrl = useServerFn(generateDeckFromUrl);
  const urlGeneratedRef = useRef<{
    fingerprint: string;
    result: Awaited<ReturnType<typeof genDeckFromUrl>>;
  } | null>(null);

  // The server render cannot see the device languages, so the remembered or guessed pair is
  // applied after mount.
  useEffect(() => {
    const preferred = loadDeckLanguagePreference();
    setTargetLanguage(preferred.targetLanguage);
    setDefinitionLanguageCode(preferred.definitionLanguage);
  }, []);

  const handleTargetLanguageChange = (value: LearningLanguage) => {
    const definition =
      value === definitionLanguageCode
        ? getDefinitionLanguageFor(value).code
        : definitionLanguageCode;
    setTargetLanguage(value);
    setDefinitionLanguageCode(definition);
    saveDeckLanguagePreference({ targetLanguage: value, definitionLanguage: definition });
  };

  const handleDefinitionLanguageChange = (value: LearningLanguage) => {
    const target = value === targetLanguage ? getDefinitionLanguageFor(value).code : targetLanguage;
    setDefinitionLanguageCode(value);
    setTargetLanguage(target);
    saveDeckLanguagePreference({ targetLanguage: target, definitionLanguage: value });
  };

  const handleUrlGenerate = async () => {
    if (!urlInput.trim() || urlLoading || isCreatingDeck) return;
    if (!isOnline) {
      setUrlError(OFFLINE_AI_MESSAGE);
      return;
    }
    setUrlLoading(true);
    setUrlError("");
    const safeCount = clampCardCount(urlCount, MIN_DECK_CARDS, MAX_DECK_CARDS, 15);
    setUrlCount(String(safeCount));
    const fingerprint = JSON.stringify({
      url: urlInput.trim(),
      description: urlDesc.trim(),
      count: safeCount,
      collectionId: selectedCollectionId,
      deckColor,
      targetLanguage,
      definitionLanguage: definitionLanguage.code,
    });
    const idempotencyKey = stableCreationKey(urlCreationRef, fingerprint);
    let result =
      urlGeneratedRef.current?.fingerprint === fingerprint ? urlGeneratedRef.current.result : null;
    if (!result) {
      try {
        result = await executeAiRequest(
          () =>
            genDeckFromUrl({
              data: {
                idempotencyKey: createAiIdempotencyKey(),
                url: urlInput.trim(),
                count: safeCount,
                targetLanguage,
                definitionLanguage: definitionLanguage.code,
              },
            }),
          "Could not extract words from this page.",
        );
        urlGeneratedRef.current = { fingerprint, result };
      } catch (err) {
        setUrlError(`AI: ${errorMessage(err, "Could not extract words")}`);
        setUrlLoading(false);
        return;
      }
    }

    try {
      const created = await createDeckWithCards(
        result.name,
        urlDesc.trim(),
        result.cards,
        selectedCollectionId,
        deckColor,
        targetLanguage,
        definitionLanguage.code,
        idempotencyKey,
      );
      setUrlInput("");
      setUrlDesc("");
      setDeckColor(null);
      urlCreationRef.current = null;
      urlGeneratedRef.current = null;
      setOpen(false);
      navigate({ to: "/deck/$deckId", params: { deckId: created.id } });
    } catch (err) {
      setUrlError(`Saving: ${errorMessage(err, "Could not create deck")}`);
    } finally {
      setUrlLoading(false);
    }
  };

  const resetManual = () => {
    setName("");
    setDesc("");
    setManualCards([]);
    setWordInput("");
    setDefinitionInput("");
    setImportText("");
    setImportMode(null);
    setImportError("");
    setImportImageName("");
    setTrWord("");
    setTrOriginalWord("");
    setTrDirection("");
    setTrInputIsDefinition(false);
    setTrOptions([]);
    setTrError("");
    setManualError("");
    manualCreationRef.current = null;
  };

  const handleCreate = async () => {
    if (!name.trim() || manualCards.length < MIN_DECK_CARDS || isCreatingDeck) return;
    if (!isOnline) {
      setManualError(OFFLINE_SAVE_MESSAGE);
      return;
    }
    setManualError("");
    const fingerprint = JSON.stringify({
      name: name.trim(),
      description: desc.trim(),
      cards: manualCards,
      collectionId: selectedCollectionId,
      deckColor,
      targetLanguage,
      definitionLanguage: definitionLanguage.code,
    });
    const idempotencyKey = stableCreationKey(manualCreationRef, fingerprint);
    try {
      const created = await createDeckWithCards(
        name.trim(),
        desc.trim(),
        manualCards,
        selectedCollectionId,
        deckColor,
        targetLanguage,
        definitionLanguage.code,
        idempotencyKey,
      );
      resetManual();
      setDeckColor(null);
      setOpen(false);
      navigate({ to: "/deck/$deckId", params: { deckId: created.id } });
    } catch {
      // The mutation already shows the concrete save error.
    }
  };

  const appendImportedCards = useCallback((cards: ManualCardDraft[]) => {
    const currentCards = manualCardsRef.current;
    const seen = new Set(
      currentCards.map(
        (card) =>
          `${card.term.toLocaleLowerCase("en-US")}::${card.definition.toLocaleLowerCase("en-US")}`,
      ),
    );
    const nextCards = [...currentCards];
    let reachedLimit = false;

    for (const card of cards) {
      if (nextCards.length >= MAX_DECK_CARDS) {
        reachedLimit = true;
        break;
      }
      const term = card.term.trim();
      const definition = card.definition.trim();
      const key = `${term.toLocaleLowerCase("en-US")}::${definition.toLocaleLowerCase("en-US")}`;
      if (!term || !definition || seen.has(key)) continue;
      seen.add(key);
      nextCards.push({ term, definition });
    }

    manualCardsRef.current = nextCards;
    setManualCards(nextCards);
    return { added: nextCards.length - currentCards.length, reachedLimit };
  }, []);

  const handleImportText = async () => {
    const text = importText.trim();
    if (!text || importMode) return;
    if (!isOnline) {
      setImportError(OFFLINE_AI_MESSAGE);
      return;
    }
    if (manualCards.length >= MAX_DECK_CARDS) {
      setImportError("This deck already has the maximum of 100 words.");
      return;
    }

    setImportMode("text");
    setImportError("");
    const idempotencyKey = createAiIdempotencyKey();
    try {
      const result = await executeAiRequest(
        () =>
          importCardsFromText({
            data: {
              idempotencyKey,
              text,
              targetLanguage,
              definitionLanguage: definitionLanguage.code,
            },
          }),
        "Could not import words from this list.",
      );
      const { added, reachedLimit } = appendImportedCards(result.cards);
      if (added > 0) {
        setImportText("");
        if (reachedLimit) {
          setImportError(
            `Added ${added} words. The remaining words were not added because a deck can contain at most ${MAX_DECK_CARDS} cards.`,
          );
        }
      } else {
        setImportError("No new words were added.");
      }
    } catch (err) {
      setImportError(errorMessage(err, "Could not import words from this list"));
    } finally {
      setImportMode(null);
    }
  };

  const handleImportImage = async (file?: File) => {
    if (!file || importMode) return;
    if (!isOnline) {
      setImportError(OFFLINE_AI_MESSAGE);
      return;
    }
    if (manualCards.length >= MAX_DECK_CARDS) {
      setImportError("This deck already has the maximum of 100 words.");
      return;
    }
    if (!isSupportedImportImageType(file.type)) {
      setImportError("Upload a PNG, JPG, or WEBP image.");
      return;
    }

    setImportMode("image");
    setImportError("");
    setImportImageName(file.name);
    const idempotencyKey = createAiIdempotencyKey();
    try {
      // Large photos (most iPhone camera shots) are resized instead of rejected.
      const image = await shrinkImageToFit(file, MAX_IMPORT_IMAGE_BYTES);
      if (!image) throw new Error("Image must be 2.5 MB or smaller.");
      const mimeType: ImportImageMimeType = image === file ? file.type : "image/jpeg";
      const dataUrl = await readFileAsDataUrl(image);
      const imageBase64 = dataUrl.split(",")[1] ?? dataUrl;
      const result = await executeAiRequest(
        () =>
          importCardsFromImage({
            data: {
              idempotencyKey,
              imageBase64,
              mimeType,
              targetLanguage,
              definitionLanguage: definitionLanguage.code,
            },
          }),
        "Could not import words from this image.",
      );
      const { added, reachedLimit } = appendImportedCards(result.cards);
      if (reachedLimit) {
        setImportError(
          `Added ${added} words. The remaining words were not added because a deck can contain at most ${MAX_DECK_CARDS} cards.`,
        );
      } else if (added === 0) {
        setImportError("No new words were added.");
      }
    } catch (err) {
      setImportError(errorMessage(err, "Could not import words from this image"));
    } finally {
      setImportMode(null);
      if (imageImportInputRef.current) imageImportInputRef.current.value = "";
    }
  };

  // CSV import is parsed in the browser, so unlike the AI imports it also works offline.
  const handleImportCsv = async (file?: File) => {
    if (!file || importMode) return;
    try {
      if (manualCards.length >= MAX_DECK_CARDS) {
        setImportError("This deck already has the maximum of 100 words.");
        return;
      }
      if (file.size > CSV_MAX_FILE_BYTES) {
        setImportError("CSV file must be 1 MB or smaller.");
        return;
      }
      setImportError("");
      const { cards, skipped } = parseDeckCsv(await file.text());
      if (cards.length === 0) {
        setImportError(
          "No words found. Put the word in the first column and the translation in the second.",
        );
        return;
      }
      const { added, reachedLimit } = appendImportedCards(cards);
      if (added > 0 && !name.trim()) setName(deckNameFromFileName(file.name));
      const notes: string[] = [];
      if (reachedLimit) notes.push(`a deck can contain at most ${MAX_DECK_CARDS} cards`);
      if (skipped > 0) notes.push(`${skipped} rows were empty, incomplete or too long`);
      if (added === 0) {
        setImportError(`No new words were added${notes.length ? `: ${notes.join("; ")}` : "."}`);
      } else if (notes.length) {
        setImportError(`Added ${added} words. Some rows were skipped: ${notes.join("; ")}.`);
      }
    } catch {
      setImportError("Could not read this CSV file.");
    } finally {
      if (csvImportInputRef.current) csvImportInputRef.current.value = "";
    }
  };

  const handleAddManualCard = () => {
    const term = wordInput.trim();
    const definition = definitionInput.trim();
    if (!term || !definition || manualCards.length >= MAX_DECK_CARDS) return;

    setManualCards((prev) => [...prev, { term, definition }]);
    setWordInput("");
    setDefinitionInput("");
    setTrWord("");
    setTrOriginalWord("");
    setTrDirection("");
    setTrInputIsDefinition(false);
    setTrOptions([]);
    setTrError("");
    setManualError("");
  };

  const handleLookup = useCallback(
    async (word: string) => {
      const w = word.trim();
      if (!w || trLoading) return;
      if (!isOnline) {
        setTrError(OFFLINE_AI_MESSAGE);
        return;
      }
      setTrLoading(true);
      setTrError("");
      setTrOptions([]);
      setTrDirection("");
      setTrOriginalWord("");
      setTrInputIsDefinition(false);
      setTrWord(w);
      const idempotencyKey = createAiIdempotencyKey();
      try {
        const res = await executeAiRequest(
          () =>
            fetchTranslations({
              data: {
                idempotencyKey,
                word: w,
                targetLanguage,
                definitionLanguage: definitionLanguage.code,
              },
            }),
          "Could not fetch translations.",
        );
        const correctedWord = res.correctedWord?.trim() ?? "";
        if (correctedWord) {
          setTrWord(correctedWord);
          setTrOriginalWord(res.originalWord?.trim() || w);
        }
        setTrOptions(res.translations);
        setTrDirection(res.direction ?? "");
        setTrInputIsDefinition(
          res.sourceLanguage === definitionLanguage.code &&
            res.targetLanguage === learningLanguage.code,
        );
      } catch (err) {
        setTrError(err instanceof Error ? err.message : "Could not fetch translations");
      } finally {
        setTrLoading(false);
      }
    },
    [
      definitionLanguage.code,
      fetchTranslations,
      isOnline,
      learningLanguage.code,
      targetLanguage,
      trLoading,
    ],
  );

  const handlePickTranslation = (translation: string) => {
    setManualCards((prev) =>
      prev.length >= MAX_DECK_CARDS
        ? prev
        : [
            ...prev,
            trInputIsDefinition
              ? { term: translation, definition: trWord }
              : { term: trWord, definition: translation },
          ],
    );
    setWordInput("");
    setDefinitionInput("");
    setTrWord("");
    setTrOriginalWord("");
    setTrDirection("");
    setTrInputIsDefinition(false);
    setTrOptions([]);
    setTrError("");
  };

  const handleCancelLookup = () => {
    setWordInput("");
    setDefinitionInput("");
    setTrWord("");
    setTrOriginalWord("");
    setTrDirection("");
    setTrInputIsDefinition(false);
    setTrOptions([]);
    setTrError("");
  };

  const handleAIGenerate = async () => {
    if (!aiName.trim() || !aiTopic.trim() || aiLoading || isCreatingDeck) return;
    if (!isOnline) {
      setAiError(OFFLINE_AI_MESSAGE);
      return;
    }
    setAiLoading(true);
    setAiError("");
    const safeCount = clampCardCount(aiCount, MIN_DECK_CARDS, MAX_DECK_CARDS, 10);
    setAiCount(String(safeCount));
    const fingerprint = JSON.stringify({
      name: aiName.trim(),
      topic: aiTopic.trim(),
      description: aiDesc.trim(),
      level: aiLevel,
      count: safeCount,
      collectionId: selectedCollectionId,
      deckColor,
      targetLanguage,
      definitionLanguage: definitionLanguage.code,
    });
    const idempotencyKey = stableCreationKey(aiCreationRef, fingerprint);
    let result =
      aiGeneratedRef.current?.fingerprint === fingerprint ? aiGeneratedRef.current.result : null;
    if (!result) {
      try {
        result = await executeAiRequest(
          () =>
            genDeck({
              data: {
                idempotencyKey: createAiIdempotencyKey(),
                topic: aiTopic.trim(),
                description: aiDesc.trim(),
                level: aiLevel as "A1" | "A2" | "B1" | "B2" | "C1" | "C2",
                count: safeCount,
                targetLanguage,
                definitionLanguage: definitionLanguage.code,
              },
            }),
          "Could not generate this deck.",
        );
        aiGeneratedRef.current = { fingerprint, result };
      } catch (err) {
        setAiError(`AI: ${errorMessage(err, "Could not generate deck")}`);
        setAiLoading(false);
        return;
      }
    }

    try {
      const created = await createDeckWithCards(
        aiName.trim(),
        result.description,
        result.cards,
        selectedCollectionId,
        deckColor,
        targetLanguage,
        definitionLanguage.code,
        idempotencyKey,
      );
      setAiName("");
      setAiTopic("");
      setAiDesc("");
      setDeckColor(null);
      aiCreationRef.current = null;
      aiGeneratedRef.current = null;
      setOpen(false);
      navigate({ to: "/deck/$deckId", params: { deckId: created.id } });
    } catch (err) {
      setAiError(`Saving: ${errorMessage(err, "Could not create deck")}`);
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="min-h-screen">
      <SiteHeader />

      <main className="mx-auto max-w-6xl px-6 py-12 md:py-16">
        {/* Hero */}
        <section className="grid md:grid-cols-[1.4fr_1fr] gap-10 items-center mb-14">
          <div className="animate-float-in">
            <p className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-accent mb-5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
              {t("home.kicker")}
            </p>
            <h1 className="font-display text-4xl md:text-6xl font-extrabold leading-[1.05] tracking-tight text-foreground">
              {t("home.title.1")} <br />
              <span className="text-primary">{t("home.title.2")}</span> {t("home.title.3")}
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
              {t("home.subtitle")}
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Dialog
                open={open}
                onOpenChange={(nextOpen) => {
                  setOpen(nextOpen);
                  if (!nextOpen) setDeckColor(null);
                }}
              >
                <DialogTrigger asChild>
                  <Button size="lg" className="rounded-full px-6 h-12 text-[15px] shadow-sm">
                    <Plus className="h-4 w-4" /> {t("home.newDeck")}
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto overscroll-contain sm:max-h-[calc(100dvh-4rem)]">
                  <DialogHeader>
                    <DialogTitle className="font-display text-2xl">{t("create.title")}</DialogTitle>
                    <DialogDescription>{t("create.desc")}</DialogDescription>
                  </DialogHeader>
                  {!isOnline && (
                    <div
                      role="alert"
                      className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
                    >
                      You are offline. Deck creation, AI, and saving are turned off until your
                      connection is back.
                    </div>
                  )}
                  <div className="space-y-2 mt-1">
                    <label className="text-sm font-medium">{t("create.collection")}</label>
                    <Select value={collectionId} onValueChange={setCollectionId}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__default__">{t("create.collectionDefault")}</SelectItem>
                        {pagedCollections.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                        {extraCollections.length > COLLECTIONS_PAGE_SIZE && (
                          <div
                            className="flex items-center justify-between gap-2 px-2 py-1.5 mt-1 border-t border-border"
                            onPointerDown={(e) => e.preventDefault()}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setCollectionPage((p) => Math.max(0, p - 1));
                              }}
                              disabled={safeCollectionPage === 0}
                              className="px-2 py-1 text-xs rounded hover:bg-secondary disabled:opacity-40 disabled:pointer-events-none"
                            >
                              {t("create.prev")}
                            </button>
                            <span className="text-xs text-muted-foreground">
                              {safeCollectionPage + 1} / {totalCollectionPages}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setCollectionPage((p) => Math.min(totalCollectionPages - 1, p + 1));
                              }}
                              disabled={safeCollectionPage >= totalCollectionPages - 1}
                              className="px-2 py-1 text-xs rounded hover:bg-secondary disabled:opacity-40 disabled:pointer-events-none"
                            >
                              {t("create.next")}
                            </button>
                          </div>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Word language</label>
                        <Select
                          value={targetLanguage}
                          onValueChange={(value) =>
                            handleTargetLanguageChange(value as LearningLanguage)
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {LEARNING_LANGUAGE_OPTIONS.map((language) => (
                              <SelectItem key={language.code} value={language.code}>
                                {language.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Translation language</label>
                        <Select
                          value={definitionLanguage.code}
                          onValueChange={(value) =>
                            handleDefinitionLanguageChange(value as LearningLanguage)
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {LEARNING_LANGUAGE_OPTIONS.map((language) => (
                              <SelectItem key={language.code} value={language.code}>
                                {language.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Words are saved in {learningLanguage.label}; translations are saved in{" "}
                      {definitionLanguage.label}.
                    </p>
                  </div>
                  <DeckColorPicker value={deckColor} onChange={setDeckColor} />
                  <Tabs defaultValue="manual" className="mt-2">
                    <TabsList className="w-full grid grid-cols-3">
                      <TabsTrigger value="manual">{t("create.tab.manual")}</TabsTrigger>
                      <TabsTrigger value="ai" className="gap-1.5">
                        <Sparkles className="h-3.5 w-3.5" /> {t("create.tab.ai")}
                      </TabsTrigger>
                      <TabsTrigger value="url" className="gap-1.5">
                        <Link2 className="h-3.5 w-3.5" /> {t("create.tab.url")}
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="manual" className="mt-4 space-y-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">{t("create.name")}</label>
                        <Input
                          autoFocus
                          placeholder={t("create.namePh")}
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">{t("create.descLabel")}</label>
                        <Textarea
                          placeholder={t("create.descPh")}
                          value={desc}
                          onChange={(e) => setDesc(e.target.value)}
                          rows={2}
                        />
                      </div>

                      <div className="space-y-3 rounded-2xl border border-border/70 bg-muted/30 p-3">
                        <div>
                          <label className="text-sm font-medium">{t("create.import.title")}</label>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {t("create.import.hint")}
                          </p>
                        </div>
                        <Textarea
                          placeholder={t("create.import.placeholder")}
                          value={importText}
                          onChange={(e) => setImportText(e.target.value)}
                          rows={4}
                          disabled={
                            !isOnline || Boolean(importMode) || manualCards.length >= MAX_DECK_CARDS
                          }
                        />
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <Button
                            type="button"
                            variant="outline"
                            className="w-full sm:w-auto"
                            onClick={handleImportText}
                            disabled={
                              !isOnline ||
                              Boolean(importMode) ||
                              !importText.trim() ||
                              manualCards.length >= MAX_DECK_CARDS
                            }
                          >
                            {importMode === "text" ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <FileText className="h-4 w-4" />
                            )}
                            {importMode === "text"
                              ? t("create.import.importing")
                              : t("create.import.list")}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            className="w-full sm:w-auto"
                            onClick={() => imageImportInputRef.current?.click()}
                            disabled={
                              !isOnline ||
                              Boolean(importMode) ||
                              manualCards.length >= MAX_DECK_CARDS
                            }
                          >
                            {importMode === "image" ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Upload className="h-4 w-4" />
                            )}
                            {importMode === "image"
                              ? t("create.import.readingImage")
                              : t("create.import.image")}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            className="w-full sm:w-auto"
                            onClick={() => csvImportInputRef.current?.click()}
                            disabled={Boolean(importMode) || manualCards.length >= MAX_DECK_CARDS}
                          >
                            <FileSpreadsheet className="h-4 w-4" />
                            {t("create.import.csv")}
                          </Button>
                          <input
                            ref={csvImportInputRef}
                            type="file"
                            accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.currentTarget.files?.[0];
                              void handleImportCsv(file);
                            }}
                          />
                          <input
                            ref={imageImportInputRef}
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.currentTarget.files?.[0];
                              void handleImportImage(file);
                            }}
                          />
                        </div>
                        {importImageName && (
                          <p className="truncate text-xs text-muted-foreground">
                            {t("create.import.lastImage")} {importImageName}
                          </p>
                        )}
                        {importError && <p className="text-sm text-destructive">{importError}</p>}
                      </div>

                      <div className="space-y-2 pt-2 border-t border-border/60">
                        <label className="text-sm font-medium">{t("create.addWord")}</label>
                        {!trWord ? (
                          <div className="space-y-2">
                            <Input
                              placeholder={`Type a ${learningLanguage.label} word`}
                              value={wordInput}
                              onChange={(e) => setWordInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (
                                  e.key === "Enter" &&
                                  wordInput.trim() &&
                                  !trLoading &&
                                  manualCards.length < MAX_DECK_CARDS
                                ) {
                                  e.preventDefault();
                                  void handleLookup(wordInput);
                                }
                              }}
                              disabled={trLoading || manualCards.length >= MAX_DECK_CARDS}
                            />
                            <Input
                              placeholder={`Type a ${definitionLanguage.label} translation`}
                              value={definitionInput}
                              onChange={(e) => setDefinitionInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (
                                  e.key === "Enter" &&
                                  wordInput.trim() &&
                                  definitionInput.trim() &&
                                  manualCards.length < MAX_DECK_CARDS
                                ) {
                                  e.preventDefault();
                                  handleAddManualCard();
                                }
                              }}
                              disabled={trLoading || manualCards.length >= MAX_DECK_CARDS}
                            />
                            <div className="flex flex-col gap-2 sm:flex-row">
                              <Button
                                type="button"
                                className="w-full sm:w-auto"
                                onClick={handleAddManualCard}
                                disabled={
                                  trLoading ||
                                  !wordInput.trim() ||
                                  !definitionInput.trim() ||
                                  manualCards.length >= MAX_DECK_CARDS
                                }
                              >
                                <Plus className="h-4 w-4" />
                                {t("create.addManual")}
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                className="w-full sm:w-auto"
                                onClick={() => handleLookup(wordInput)}
                                disabled={
                                  !isOnline ||
                                  trLoading ||
                                  !wordInput.trim() ||
                                  manualCards.length >= MAX_DECK_CARDS
                                }
                              >
                                {trLoading ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Search className="h-4 w-4" />
                                )}
                                {t("create.findTr")}
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-xl border border-border bg-muted/40 p-3 space-y-2">
                            <div className="flex items-center justify-between">
                              <p className="text-sm text-muted-foreground">
                                Word:{" "}
                                <span className="font-semibold text-foreground">{trWord}</span>
                              </p>
                              {trDirection && (
                                <span className="text-xs text-muted-foreground">{trDirection}</span>
                              )}
                              <button
                                type="button"
                                onClick={handleCancelLookup}
                                className="text-xs text-muted-foreground hover:text-foreground"
                              >
                                {t("create.cancel")}
                              </button>
                            </div>
                            {trOriginalWord && (
                              <p className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-muted-foreground">
                                {t("create.corrected")}{" "}
                                <span className="font-semibold text-foreground">
                                  {trOriginalWord}
                                </span>{" "}
                                {t("create.correctedTo")}{" "}
                                <span className="font-semibold text-foreground">{trWord}</span>.
                              </p>
                            )}
                            {trLoading ? (
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin text-accent" />
                                Finding translations...
                              </div>
                            ) : (
                              <>
                                <p className="text-sm font-medium">
                                  {t("create.pickTr")}{" "}
                                  <span className="text-primary">{trWord}</span>
                                </p>
                                <div className="flex flex-wrap gap-2">
                                  {trOptions.map((opt) => (
                                    <button
                                      key={opt}
                                      type="button"
                                      onClick={() => handlePickTranslation(opt)}
                                      disabled={manualCards.length >= MAX_DECK_CARDS}
                                      className="px-3 py-1.5 rounded-full bg-card border border-border text-sm hover:border-primary hover:text-primary transition-colors"
                                    >
                                      {opt}
                                    </button>
                                  ))}
                                </div>
                              </>
                            )}
                          </div>
                        )}
                        {trError && <p className="text-sm text-destructive">{trError}</p>}
                        {manualError && <p className="text-sm text-destructive">{manualError}</p>}
                      </div>

                      {manualCards.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-sm font-medium">
                            {t("create.cardsIn")} ({manualCards.length})
                          </p>
                          <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                            {manualCards.map((c, i) => (
                              <div
                                key={i}
                                className="flex items-center justify-between gap-2 rounded-lg bg-secondary/60 px-3 py-1.5 text-sm"
                              >
                                <span className="truncate">
                                  <span className="font-medium">{c.term}</span>
                                  <span className="text-muted-foreground"> — {c.definition}</span>
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setManualCards((prev) => prev.filter((_, j) => j !== i))
                                  }
                                  className="text-muted-foreground hover:text-destructive shrink-0"
                                  aria-label={t("create.remove")}
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <DialogFooter>
                        <Button
                          variant="ghost"
                          onClick={() => {
                            resetManual();
                            setDeckColor(null);
                            setOpen(false);
                          }}
                        >
                          {t("create.cancel")}
                        </Button>
                        <Button
                          onClick={handleCreate}
                          disabled={
                            !isOnline ||
                            isCreatingDeck ||
                            !name.trim() ||
                            manualCards.length < MIN_DECK_CARDS
                          }
                        >
                          {isCreatingDeck ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Check className="h-4 w-4" />
                          )}{" "}
                          {t("create.confirm")} ({manualCards.length})
                        </Button>
                      </DialogFooter>
                    </TabsContent>

                    <TabsContent value="ai" className="mt-4 space-y-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">{t("create.name")}</label>
                        <Input
                          autoFocus
                          placeholder={t("create.namePh")}
                          value={aiName}
                          onChange={(e) => setAiName(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && !aiLoading && handleAIGenerate()}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">{t("create.ai.topic")}</label>
                        <Input
                          placeholder={t("create.ai.topicPh")}
                          value={aiTopic}
                          onChange={(e) => setAiTopic(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && !aiLoading && handleAIGenerate()}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">{t("create.descLabel")}</label>
                        <Textarea
                          placeholder={t("create.descPh")}
                          value={aiDesc}
                          onChange={(e) => setAiDesc(e.target.value)}
                          rows={2}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("create.ai.level")}</label>
                          <select
                            value={aiLevel}
                            onChange={(e) => setAiLevel(e.target.value)}
                            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm"
                          >
                            {["A1", "A2", "B1", "B2", "C1", "C2"].map((l) => (
                              <option key={l} value={l}>
                                {l}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("create.ai.count")}</label>
                          <Input
                            type="number"
                            min={MIN_DECK_CARDS}
                            max={MAX_DECK_CARDS}
                            value={aiCount}
                            onChange={(e) => setAiCount(e.target.value)}
                            onBlur={() =>
                              setAiCount(
                                String(clampCardCount(aiCount, MIN_DECK_CARDS, MAX_DECK_CARDS, 10)),
                              )
                            }
                          />
                        </div>
                      </div>
                      {aiError && <p className="text-sm text-destructive">{aiError}</p>}
                      <DialogFooter>
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setAiName("");
                            setAiTopic("");
                            setAiDesc("");
                            setDeckColor(null);
                            setOpen(false);
                          }}
                        >
                          {t("create.cancel")}
                        </Button>
                        <Button
                          onClick={handleAIGenerate}
                          disabled={
                            !isOnline ||
                            aiLoading ||
                            isCreatingDeck ||
                            !aiName.trim() ||
                            !aiTopic.trim()
                          }
                        >
                          {aiLoading ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />{" "}
                              {t("create.ai.generating")}
                            </>
                          ) : (
                            <>
                              <Sparkles className="h-4 w-4" /> {t("create.ai.generate")}
                            </>
                          )}
                        </Button>
                      </DialogFooter>
                    </TabsContent>

                    <TabsContent value="url" className="mt-4 space-y-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">{t("create.url.label")}</label>
                        <Input
                          autoFocus
                          type="url"
                          placeholder="https://en.wikipedia.org/wiki/..."
                          value={urlInput}
                          onChange={(e) => setUrlInput(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && !urlLoading && handleUrlGenerate()}
                        />
                        <p className="text-xs text-muted-foreground">{t("create.url.hint")}</p>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">{t("create.descLabel")}</label>
                        <Textarea
                          placeholder={t("create.descPh")}
                          value={urlDesc}
                          onChange={(e) => setUrlDesc(e.target.value)}
                          rows={2}
                        />
                      </div>
                      <div className="space-y-2 max-w-[160px]">
                        <label className="text-sm font-medium">{t("create.ai.count")}</label>
                        <Input
                          type="number"
                          min={MIN_DECK_CARDS}
                          max={MAX_DECK_CARDS}
                          value={urlCount}
                          onChange={(e) => setUrlCount(e.target.value)}
                          onBlur={() =>
                            setUrlCount(
                              String(clampCardCount(urlCount, MIN_DECK_CARDS, MAX_DECK_CARDS, 15)),
                            )
                          }
                        />
                      </div>
                      {urlError && <p className="text-sm text-destructive">{urlError}</p>}
                      <DialogFooter>
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setUrlInput("");
                            setUrlDesc("");
                            setDeckColor(null);
                            setOpen(false);
                          }}
                        >
                          {t("create.cancel")}
                        </Button>
                        <Button
                          onClick={handleUrlGenerate}
                          disabled={!isOnline || urlLoading || isCreatingDeck || !urlInput.trim()}
                        >
                          {urlLoading ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />{" "}
                              {t("create.url.extracting")}
                            </>
                          ) : (
                            <>
                              <Link2 className="h-4 w-4" /> {t("create.url.create")}
                            </>
                          )}
                        </Button>
                      </DialogFooter>
                    </TabsContent>
                  </Tabs>
                </DialogContent>
              </Dialog>
              {sortedDecks[0] && (
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="rounded-full px-6 h-12 text-[15px] bg-card"
                >
                  <Link to="/study/$deckId" params={{ deckId: sortedDecks[0].id }}>
                    <BookOpen className="h-4 w-4" /> {t("home.continue")}
                  </Link>
                </Button>
              )}
            </div>

            <div className="mt-10 grid grid-cols-3 gap-3 max-w-md">
              {[
                { label: t("home.stats.decks"), value: decks.length },
                {
                  label: t("home.stats.cards"),
                  value: decks.reduce((s, d) => s + d.cards.length, 0),
                },
                {
                  label: t("home.stats.known"),
                  value: decks.reduce((s, d) => s + d.cards.filter((c) => c.known).length, 0),
                },
              ].map((s) => (
                <div
                  key={s.label}
                  className="rounded-2xl bg-card border border-border/70 px-4 py-3 shadow-[var(--shadow-soft)]"
                >
                  <p className="text-2xl font-display font-bold text-primary tabular-nums">
                    {s.value}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="relative hidden md:block">
            <div className="absolute -inset-4 rounded-[2rem] bg-gradient-to-br from-accent/20 via-transparent to-primary/10 blur-2xl" />
            <div className="relative">
              <StreakCard />
            </div>
          </div>
        </section>

        {/* Streak — mobile */}
        <section className="md:hidden mb-10">
          <StreakCard />
        </section>

        {/* Review forecast */}
        {decks.length > 0 && <ReviewForecastCard decks={decks} />}

        {/* Decks */}
        <section>
          <div className="flex items-baseline justify-between mb-6">
            <h2 className="font-display text-2xl md:text-3xl font-bold tracking-tight">
              {t("home.yourDecks")}
            </h2>
            <span className="text-sm text-muted-foreground">
              {query
                ? `${t("home.searchFound")}: ${filteredDecks.length}`
                : `${decks.length} ${t("home.decks.suffix")}`}
            </span>
          </div>

          {decks.length === 0 ? (
            <div className="rounded-3xl border-2 border-dashed border-border bg-card/50 p-16 text-center">
              <p className="text-muted-foreground">{t("home.empty")}</p>
            </div>
          ) : query && filteredDecks.length === 0 ? (
            <div className="rounded-3xl border-2 border-dashed border-border bg-card/50 p-16 text-center">
              <p className="text-muted-foreground">{t("home.searchNothing")}</p>
            </div>
          ) : (
            <>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {visibleDecks.map((deck) => {
                  const known = deck.cards.filter((c) => c.known).length;
                  const total = deck.cards.length;
                  const pct = total ? Math.round((known / total) * 100) : 0;
                  const deckColorOption = getDeckColorOption(deck.coverColor);
                  return (
                    <div
                      key={deck.id}
                      className={cn(
                        "group relative rounded-3xl border p-6 shadow-[var(--shadow-soft)] transition-all duration-300 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-[var(--shadow-card)]",
                        deckColorOption.cardClass,
                      )}
                    >
                      <Link to="/deck/$deckId" params={{ deckId: deck.id }} className="block">
                        <h3 className="font-display text-xl font-bold leading-tight tracking-tight">
                          {deck.name}
                        </h3>
                        {deck.description && (
                          <p className="mt-2 text-sm text-muted-foreground line-clamp-2 leading-relaxed">
                            {deck.description}
                          </p>
                        )}

                        <div className="mt-6">
                          <div className="flex justify-between text-xs font-medium text-muted-foreground mb-1.5">
                            <span>
                              {total} {t("home.cards.suffix")}
                            </span>
                            <span className="text-primary tabular-nums">{pct}%</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                            <div
                              className={cn(
                                "h-full bg-gradient-to-r transition-all duration-500",
                                deckColorOption.progressClass,
                              )}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      </Link>

                      <div className="mt-5 flex items-start justify-between gap-2">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <Link
                            to="/study/$deckId"
                            params={{ deckId: deck.id }}
                            className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-foreground bg-primary px-3 py-2 rounded-full hover:bg-primary/90 transition-colors"
                          >
                            <BookOpen className="h-3.5 w-3.5" /> {t("home.study")}
                          </Link>
                          <Link
                            to="/deck/$deckId"
                            params={{ deckId: deck.id }}
                            className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary bg-primary/10 border border-primary/20 px-3 py-2 rounded-full hover:bg-primary/20 transition-colors"
                          >
                            <LayoutGrid className="h-3.5 w-3.5" /> {t("home.modes")}
                          </Link>
                          <Link
                            to="/publish"
                            search={{ type: "deck", id: deck.id }}
                            className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary bg-primary/10 border border-primary/20 px-3 py-2 rounded-full hover:bg-primary/20 transition-colors"
                          >
                            <Globe2 className="h-3.5 w-3.5" /> Publish
                          </Link>
                        </div>
                        <button
                          onClick={() => setDeleteDeckId(deck.id)}
                          className="h-9 w-9 inline-flex items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100"
                          aria-label={t("home.deleteDeck")}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              {hasMore && (
                <div className="mt-8 flex justify-center">
                  <Link
                    to="/decks"
                    className="inline-flex items-center gap-2 rounded-full bg-secondary hover:bg-secondary/80 px-6 h-12 text-sm font-semibold transition-colors"
                  >
                    {t("home.yourDecks")} →
                  </Link>
                </div>
              )}
            </>
          )}
        </section>
      </main>

      <Dialog open={deleteDeckId !== null} onOpenChange={(o) => !o && setDeleteDeckId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">{t("home.deleteDeckTitle")}</DialogTitle>
            <DialogDescription>
              {deckToDelete ? (
                <>
                  «<strong>{deckToDelete.name}</strong>» — {t("home.deleteDeckDescGeneric")}
                </>
              ) : (
                t("home.deleteDeckDescGeneric")
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteDeckId(null)}>
              {t("create.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteDeckId) deleteDeck(deleteDeckId);
                setDeleteDeckId(null);
              }}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {t("create.remove")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <footer className="mx-auto max-w-6xl px-6 py-10 text-center text-sm text-muted-foreground">
        {t("home.footer")}
        <LegalLinks className="mt-3 justify-center" />
      </footer>
    </div>
  );
}
