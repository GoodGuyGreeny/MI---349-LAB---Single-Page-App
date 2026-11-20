"use strict";

const API_BASE = "https://pokeapi.co/api/v2";
const DISCOVERY_LIMIT = 24;
const MAX_POKEMON_ID = 1025;

const typeColors = {
  normal: "#A8A77A", fire: "#EE8130", water: "#6390F0", electric: "#F7D02C",
  grass: "#7AC74C", ice: "#96D9D6", fighting: "#C22E28", poison: "#A33EA1",
  ground: "#E2BF65", flying: "#A98FF3", psychic: "#F85888", bug: "#A6B91A",
  rock: "#B6A136", ghost: "#735797", dragon: "#6F35FC", dark: "#705746",
  steel: "#B7B7CE", fairy: "#D685AD"
};

const pokemonCache = new Map();
let discoveryOffset = 0;
let loadedPokemon = [];
let discoveryRequestActive = false;
let searchRequestActive = false;
let randomRequestActive = false;
let requestSequence = 0;

const pokemonGrid = document.querySelector("#pokemonGrid");
const discoveryStatus = document.querySelector("#discoveryStatus");
const collectionCount = document.querySelector("#collectionCount");
const loadMoreButton = document.querySelector("#loadMoreButton");
const searchForm = document.querySelector("#searchForm");
const pokemonSearch = document.querySelector("#pokemonSearch");
const searchButton = document.querySelector("#searchButton");
const randomButton = document.querySelector("#randomButton");
const searchError = document.querySelector("#searchError");
const detailSection = document.querySelector("#detailSection");
const detailPanel = document.querySelector("#detailPanel");
const detailContent = document.querySelector("#detailContent");
const closeDetail = document.querySelector("#closeDetail");
const apiStatus = document.querySelector("#apiStatus");
const apiStatusText = document.querySelector("#apiStatusText");

async function fetchPokemon(identifier) {
  const key = String(identifier).trim().toLowerCase();
  if (pokemonCache.has(key)) return pokemonCache.get(key);

  const response = await fetch(`${API_BASE}/pokemon/${encodeURIComponent(key)}`);
  if (!response.ok) {
    throw new Error(response.status === 404 ? "Pokemon not found" : "Network request failed");
  }

  const pokemon = await response.json();
  pokemonCache.set(String(pokemon.id), pokemon);
  pokemonCache.set(pokemon.name.toLowerCase(), pokemon);
  return pokemon;
}

async function fetchPokemonBatch(offset, limit) {
  const response = await fetch(`${API_BASE}/pokemon?limit=${limit}&offset=${offset}`);
  if (!response.ok) throw new Error("Unable to load Pokémon");

  const data = await response.json();
  const detailRequests = data.results.map((item) =>
    () => fetchPokemon(item.name).catch(() => null)
  );
  const settled = await runInBatches(detailRequests, 6);
  return { results: settled.filter(Boolean), next: data.next };
}

async function runInBatches(requestFunctions, batchSize) {
  const results = [];
  for (let index = 0; index < requestFunctions.length; index += batchSize) {
    const batch = requestFunctions.slice(index, index + batchSize);
    results.push(...await Promise.all(batch.map((request) => request())));
  }
  return results;
}

function formatPokemonName(name) {
  return name
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatPokemonNumber(id) {
  return `#${String(id).padStart(4, "0")}`;
}

function getPokemonArtwork(pokemon) {
  return pokemon?.sprites?.other?.["official-artwork"]?.front_default ||
    pokemon?.sprites?.front_default ||
    null;
}

function setApiStatus(type, message) {
  apiStatus.className = `api-status status-${type}`;
  apiStatusText.textContent = message;
}

function setButtonLoading(button, isLoading, loadingText) {
  if (!button.dataset.defaultText) button.dataset.defaultText = button.textContent.trim();
  button.disabled = isLoading;
  const text = button.querySelector("span");
  if (text) text.textContent = isLoading ? loadingText : button.dataset.defaultText;
}

function showSkeletons(count = DISCOVERY_LIMIT) {
  pokemonGrid.replaceChildren();
  for (let index = 0; index < count; index += 1) {
    const skeleton = document.createElement("div");
    skeleton.className = "skeleton-card";
    skeleton.setAttribute("aria-hidden", "true");
    pokemonGrid.appendChild(skeleton);
  }
}

function createTextElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function createTypeBadge(typeName) {
  const badge = createTextElement("span", "type-badge", typeName);
  badge.style.setProperty("--type-color", typeColors[typeName] || "#94A3B8");
  return badge;
}

function createPlaceholderArtwork() {
  const placeholder = createTextElement("div", "placeholder-artwork", "Image unavailable");
  return placeholder;
}

function renderPokemonCard(pokemon) {
  const article = document.createElement("article");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "pokemon-card";
  button.dataset.pokemonId = String(pokemon.id);
  button.setAttribute("aria-label", `View details for ${formatPokemonName(pokemon.name)}, ${formatPokemonNumber(pokemon.id)}`);

  const primaryType = pokemon.types[0]?.type?.name || "normal";
  button.style.setProperty("--type-color", typeColors[primaryType] || "#94A3B8");

  button.appendChild(createTextElement("span", "card-number", formatPokemonNumber(pokemon.id)));
  button.appendChild(createTextElement("h3", "", formatPokemonName(pokemon.name)));

  const artworkWrap = document.createElement("div");
  artworkWrap.className = "pokemon-artwork-wrap";
  const artwork = getPokemonArtwork(pokemon);
  if (artwork) {
    const image = document.createElement("img");
    image.className = "pokemon-artwork";
    image.src = artwork;
    image.alt = `Official artwork of ${formatPokemonName(pokemon.name)}`;
    image.loading = "lazy";
    image.decoding = "async";
    artworkWrap.appendChild(image);
  } else {
    artworkWrap.appendChild(createPlaceholderArtwork());
  }
  button.appendChild(artworkWrap);

  const types = document.createElement("div");
  types.className = "card-types";
  pokemon.types.forEach((entry) => types.appendChild(createTypeBadge(entry.type.name)));
  button.appendChild(types);

  button.addEventListener("click", () => openPokemonDetails(pokemon));
  article.appendChild(button);
  return article;
}

async function loadInitialDiscovery() {
  if (discoveryRequestActive) return;
  discoveryRequestActive = true;
  showSkeletons();
  discoveryStatus.textContent = "Loading the first Pokémon...";
  loadMoreButton.hidden = true;

  try {
    const batch = await fetchPokemonBatch(discoveryOffset, DISCOVERY_LIMIT);
    loadedPokemon = batch.results;
    discoveryOffset = loadedPokemon.length;
    pokemonGrid.replaceChildren();
    batch.results.forEach((pokemon) => pokemonGrid.appendChild(renderPokemonCard(pokemon)));
    collectionCount.textContent = `${loadedPokemon.length} discovered`;
    discoveryStatus.textContent = "";
    setApiStatus("success", "POKÉAPI CONNECTED");
    loadMoreButton.hidden = !batch.next;
  } catch (error) {
    pokemonGrid.replaceChildren();
    discoveryStatus.textContent = "Couldn’t connect to PokéAPI.";
    setApiStatus("error", "POKÉAPI UNAVAILABLE");
    showDiscoveryError();
  } finally {
    discoveryRequestActive = false;
  }
}

function showDiscoveryError() {
  const retry = createTextElement("button", "button button-primary", "Retry");
  retry.type = "button";
  retry.style.marginTop = "12px";
  retry.addEventListener("click", () => {
    discoveryOffset = 0;
    loadedPokemon = [];
    loadInitialDiscovery();
  });
  pokemonGrid.appendChild(retry);
}

async function loadMorePokemon() {
  if (discoveryRequestActive) return;
  discoveryRequestActive = true;
  loadMoreButton.disabled = true;
  loadMoreButton.querySelector("span").textContent = "Loading...";
  discoveryStatus.textContent = "Loading more Pokémon...";

  try {
    const batch = await fetchPokemonBatch(discoveryOffset, DISCOVERY_LIMIT);
    const seenIds = new Set(loadedPokemon.map((pokemon) => pokemon.id));
    const uniqueResults = batch.results.filter((pokemon) => {
      if (seenIds.has(pokemon.id)) return false;
      seenIds.add(pokemon.id);
      return true;
    });

    uniqueResults.forEach((pokemon) => {
      loadedPokemon.push(pokemon);
      pokemonGrid.appendChild(renderPokemonCard(pokemon));
    });
    discoveryOffset += DISCOVERY_LIMIT;
    collectionCount.textContent = `${loadedPokemon.length} discovered`;
    discoveryStatus.textContent = "";
    setApiStatus("success", "POKÉAPI CONNECTED");
    loadMoreButton.hidden = !batch.next;
  } catch (error) {
    discoveryStatus.textContent = "More Pokémon couldn’t be loaded. Please try again.";
  } finally {
    discoveryRequestActive = false;
    loadMoreButton.disabled = false;
    loadMoreButton.querySelector("span").textContent = "Load More Pokémon";
  }
}

async function handleSearch(event) {
  event.preventDefault();
  if (searchRequestActive) return;

  const query = pokemonSearch.value.trim().toLowerCase();
  searchError.textContent = "";
  if (!query) {
    searchError.textContent = "Enter a Pokémon name or Pokédex number.";
    pokemonSearch.focus();
    return;
  }

  searchRequestActive = true;
  const sequence = ++requestSequence;
  setButtonLoading(searchButton, true, "Searching...");
  randomButton.disabled = true;
  discoveryStatus.textContent = "Searching PokéAPI...";

  try {
    const pokemon = await fetchPokemon(query);
    if (sequence !== requestSequence) return;
    openPokemonDetails(pokemon);
    discoveryStatus.textContent = `Showing ${formatPokemonName(pokemon.name)}.`;
  } catch (error) {
    if (sequence !== requestSequence) return;
    if (error.message === "Pokemon not found") {
      searchError.textContent = "Pokémon not found. Try another name or number.";
    } else {
      searchError.textContent = "PokéAPI could not be reached. Check your connection and try again.";
      setApiStatus("error", "POKÉAPI UNAVAILABLE");
    }
  } finally {
    if (sequence === requestSequence) {
      searchRequestActive = false;
      setButtonLoading(searchButton, false);
      if (!randomRequestActive) randomButton.disabled = false;
    }
  }
}

async function showRandomPokemon() {
  if (randomRequestActive || searchRequestActive) return;
  randomRequestActive = true;
  ++requestSequence;
  setButtonLoading(randomButton, true, "Finding...");
  searchButton.disabled = searchRequestActive;
  discoveryStatus.textContent = "Finding a random Pokémon...";
  searchError.textContent = "";

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const randomId = Math.floor(Math.random() * MAX_POKEMON_ID) + 1;
    try {
      const pokemon = await fetchPokemon(randomId);
      openPokemonDetails(pokemon);
      discoveryStatus.textContent = `Showing ${formatPokemonName(pokemon.name)}.`;
      randomRequestActive = false;
      setButtonLoading(randomButton, false);
      searchButton.disabled = false;
      return;
    } catch (error) {
      if (attempt === 3) {
        searchError.textContent = "Couldn’t find a random Pokémon. Please try again.";
      }
    }
  }

  randomRequestActive = false;
  setButtonLoading(randomButton, false);
  searchButton.disabled = false;
}

function openPokemonDetails(pokemon) {
  const primaryType = pokemon.types[0]?.type?.name || "normal";
  const primaryColor = typeColors[primaryType] || "#94A3B8";
  detailPanel.style.setProperty("--detail-type-color", primaryColor);
  detailContent.replaceChildren();

  const grid = document.createElement("div");
  grid.className = "detail-grid";

  const artworkWrap = document.createElement("div");
  artworkWrap.className = "detail-artwork-wrap";
  const artwork = getPokemonArtwork(pokemon);
  if (artwork) {
    const image = document.createElement("img");
    image.className = "detail-artwork";
    image.src = artwork;
    image.alt = `Official artwork of ${formatPokemonName(pokemon.name)}`;
    artworkWrap.appendChild(image);
  } else {
    artworkWrap.appendChild(createPlaceholderArtwork());
  }
  grid.appendChild(artworkWrap);

  const info = document.createElement("div");
  info.className = "detail-info";
  info.appendChild(createTextElement("span", "detail-number", formatPokemonNumber(pokemon.id)));
  info.appendChild(createTextElement("h2", "", formatPokemonName(pokemon.name)));

  const detailTypes = document.createElement("div");
  detailTypes.className = "detail-types";
  pokemon.types.forEach((entry) => detailTypes.appendChild(createTypeBadge(entry.type.name)));
  info.appendChild(detailTypes);

  const facts = document.createElement("div");
  facts.className = "detail-facts";
  const factData = [
    ["Height", `${(pokemon.height / 10).toFixed(1)} m`],
    ["Weight", `${(pokemon.weight / 10).toFixed(1)} kg`],
    ["Base Experience", String(pokemon.base_experience ?? "Unknown")]
  ];
  factData.forEach(([label, value]) => {
    const fact = document.createElement("div");
    fact.className = "fact";
    fact.appendChild(createTextElement("span", "fact-label", label));
    fact.appendChild(createTextElement("strong", "fact-value", value));
    facts.appendChild(fact);
  });
  info.appendChild(facts);

  const abilitiesLabel = createTextElement("span", "fact-label", "Abilities");
  const abilities = document.createElement("div");
  abilities.className = "abilities";
  pokemon.abilities.forEach((entry) => {
    const name = entry.is_hidden ? `${entry.ability.name} (Hidden)` : entry.ability.name;
    abilities.appendChild(createTextElement("span", "ability-badge", name.replaceAll("-", " ")));
  });
  info.appendChild(abilitiesLabel);
  info.appendChild(abilities);

  info.appendChild(createTextElement("h3", "stats-title", "Base Statistics"));
  const statNames = {
    hp: "HP",
    attack: "Attack",
    defense: "Defense",
    "special-attack": "Special Attack",
    "special-defense": "Special Defense",
    speed: "Speed"
  };
  const statsList = document.createElement("div");
  statsList.className = "stats-list";

  pokemon.stats.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "stat-row";
    row.appendChild(createTextElement("span", "stat-label", statNames[entry.stat.name] || entry.stat.name));

    const track = document.createElement("div");
    track.className = "stat-track";
    track.setAttribute("aria-label", `${statNames[entry.stat.name]}: ${entry.base_stat}`);
    const fill = document.createElement("div");
    fill.className = "stat-fill";
    fill.dataset.value = String(Math.min(entry.base_stat, 255));
    track.appendChild(fill);
    row.appendChild(track);
    row.appendChild(createTextElement("span", "stat-value", String(entry.base_stat)));
    statsList.appendChild(row);
  });
  info.appendChild(statsList);
  grid.appendChild(info);
  detailContent.appendChild(grid);
  detailSection.hidden = false;

  requestAnimationFrame(() => {
    detailContent.querySelectorAll(".stat-fill").forEach((fill) => {
      fill.style.width = `${(Number(fill.dataset.value) / 255) * 100}%`;
    });
  });

  detailSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closePokemonDetails() {
  detailSection.hidden = true;
  pokemonSearch.focus();
  document.querySelector(".discovery-section").scrollIntoView({ behavior: "smooth", block: "start" });
}

searchForm.addEventListener("submit", handleSearch);
randomButton.addEventListener("click", showRandomPokemon);
loadMoreButton.addEventListener("click", loadMorePokemon);
closeDetail.addEventListener("click", closePokemonDetails);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !detailSection.hidden) closePokemonDetails();
});

loadInitialDiscovery();
