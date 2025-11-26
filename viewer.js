#!/usr/bin/env node
// ============================================================
// ファイル名      : viewer.js
// 役割           : 同期会アルバムビューア（PAAS）の画面遷移と表示制御。
//                   - 第1画面：カテゴリ一覧
//                   - 第2画面：サムネイル一覧（カテゴリ配下をグループごと）
//                   - 第3画面：拡大表示
//                 window.PHOTOS_INDEX（photos_index.js）が前提。
//                 構造:
//                   PHOTOS_INDEX = {
//                     categories: {
//                       "<catKey>": {
//                         title: "<カテゴリ名>",
//                         groups: [
//                           {
//                             name: "<グループ名>",
//                             photos: [
//                               { filename: "<ファイル名>", src: "<画像パス>" },
//                               ...
//                             ]
//                           },
//                           ...
//                         ]
//                       },
//                       ...
//                     }
//                   }
//
// バージョン     : v0.8 (Fix)
// 作成日         : 2025-11-22
// 更新日         : 2025-11-24
//   - 第3画面 context 表示を
//       「カテゴリ / グループ名 / サブフォルダID(任意)」に統一
//   - サブフォルダID が "X" の場合は context に表示しない
//   - 第3画面右下の「戻る（🔙）」ボタン（class="back-button"）を有効化
// 保存先         : /Users/yoichiamano/Projects/Album_Viewer/PAAS/
//
// 実行方法       :
//   - index.html と同じフォルダに保存し、
//     ブラウザで index.html を開けば自動的に読み込まれる。
//   - 直接このファイルを実行する必要はない。
//
// 前提ファイル:
//   - index.html
//   - style.css
//   - photos_index.js （Photo_index_Generater で自動生成）
//
// 注意事項:
//   - 画面構成は 3 画面方式固定。
//   - 第3画面の表示内容（カテゴリ名 / グループ名 / ファイル名 / サブフォルダ）は
//       formatGroupLabelForContext により
//       「1.9.集合写真 → 集合写真」
//       「1.5.全体歓談 → 全体歓談」
//     の形式に変換される。
//   - サブフォルダID（subId）が "X" の場合は context には出さない。
//   - 🔙 ボタンは class="back-button" で取得し、第2画面へ戻る。
// ============================================================

(function () {
  "use strict";

  // ----------------------------------------------------------
  // DOM 要素参照
  // ----------------------------------------------------------

  let screenCategory;
  let screenGallery;
  let screenViewer;

  let categoryList;
  let galleryTitle;
  let galleryContainer;

  let viewerImage;
  let viewerFilename;
  let viewerContext;
  let viewerCloseButton;

  let homeButton;
  let backButton; // 🔙 用

  // 現在の表示状態（第3画面用）
  let currentCategoryKey = null;
  let currentGroupIndex = null;
  let currentPhotoIndex = null;

  // ----------------------------------------------------------
  // 内部UI命名の正規表現
  //   <catID>.<grpID>.<subID>_<seq>.<ext>
  //   例: 1.6.1-1_001.jpg, 1.7.バスケット_003.JPG
  // ----------------------------------------------------------
  const INTERNAL_NAME_RE =
    /^([^.]+)\.([^.]+)\.([^_]+)_(\d{3})\.([A-Za-z0-9]+)$/;

  function extractSubIdFromFilename(filename) {
    const m = INTERNAL_NAME_RE.exec(filename || "");
    if (!m) return null;
    return m[3]; // subID 部分
  }

  function extractGrpIdFromGroupName(groupName) {
    const name = groupName || "";
    const parts = name.split(".");
    if (parts.length >= 2 && /^\d+$/.test(parts[1])) {
      return parseInt(parts[1], 10);
    }
    return Number.MAX_SAFE_INTEGER;
  }

  function buildGroupOrder(groups) {
    const indices = groups.map((_, idx) => idx);
    indices.sort((a, b) => {
      const ga = groups[a];
      const gb = groups[b];
      const ida = extractGrpIdFromGroupName(ga && ga.name);
      const idb = extractGrpIdFromGroupName(gb && gb.name);
      return ida - idb;
    });
    return indices;
  }

  // ----------------------------------------------------------
  // subID ごとに写真分割
  // ----------------------------------------------------------

  function splitPhotosBySubId(photos) {
    const map = new Map();
    photos.forEach((photo, index) => {
      const subId = extractSubIdFromFilename(photo.filename || "");
      if (!subId) return;
      if (!map.has(subId)) {
        map.set(subId, { subId: subId, items: [] });
      }
      map.get(subId).items.push({ photo, index });
    });

    const blocks = Array.from(map.values());
    if (blocks.length <= 1) return null;
    return blocks;
  }

  // ----------------------------------------------------------
  // 画面切替
  // ----------------------------------------------------------

  function showScreen(name) {
    if (screenCategory) {
      screenCategory.style.display = "none";
      screenCategory.classList.remove("screen-active");
    }
    if (screenGallery) {
      screenGallery.style.display = "none";
      screenGallery.classList.remove("screen-active");
    }
    if (screenViewer) {
      screenViewer.style.display = "none";
      screenViewer.classList.remove("screen-active");
    }

    if (name === "category") {
      screenCategory.style.display = "block";
      screenCategory.classList.add("screen-active");
    } else if (name === "gallery") {
      screenGallery.style.display = "block";
      screenGallery.classList.add("screen-active");
    } else if (name === "viewer") {
      screenViewer.style.display = "block";
      screenViewer.classList.add("screen-active");
    }

    if (homeButton) {
      homeButton.style.display = name === "category" ? "none" : "block";
    }
  }

  // ----------------------------------------------------------
  // カテゴリ名整形（番号除去）
  //   例: "1.1次会・2次会" → "1次会・2次会"
  // ----------------------------------------------------------

  function formatCategoryTitle(rawTitle, catKey) {
    const base = rawTitle || catKey || "";
    const dotIndex = base.indexOf(".");
    if (dotIndex >= 0) return base.slice(dotIndex + 1);
    return base;
  }

  // ----------------------------------------------------------
  // 第2画面：グループタイトル（【全体歓談】など）
  //   例: "1.9.集合写真" → "【集合写真】"
  // ----------------------------------------------------------

  function formatGroupTitle(groupName) {
    const name = groupName || "";
    const parts = name.split(".");
    if (parts.length >= 3) {
      return `【${parts.slice(2).join(".")}】`;
    }
    return `【${name}】`;
  }

  // ----------------------------------------------------------
  // 第3画面用：グループ名（番号除去して素の名前だけ）
  //   例: "1.9.集合写真" → "集合写真"
  // ----------------------------------------------------------

  function formatGroupLabelForContext(groupName) {
    const name = groupName || "";
    const parts = name.split(".");
    if (parts.length >= 3) {
      return parts.slice(2).join(".");
    }
    return name;
  }

  // ----------------------------------------------------------
  // ファイル名整形
  //   例: "1.2.X_009.jpg" → "009.jpg"
  // ----------------------------------------------------------

  function formatDisplayFilename(filename) {
    const base = filename || "";
    const pos = base.indexOf("_");
    if (pos >= 0) return base.slice(pos + 1);
    return base;
  }

  // ----------------------------------------------------------
  // 第1画面：カテゴリ一覧
  // ----------------------------------------------------------

  function renderCategoryList() {
    const categories = window.PHOTOS_INDEX.categories;
    const catKeys = Object.keys(categories).sort();
    categoryList.innerHTML = "";

    catKeys.forEach((catKey) => {
      const cat = categories[catKey];
      const displayTitle = formatCategoryTitle(cat.title, catKey);

      let total = 0;
      cat.groups.forEach((g) => (total += g.photos.length));

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "category-card";
      btn.textContent =
        total > 0 ? `${displayTitle}（${total}枚）` : displayTitle;

      btn.addEventListener("click", () => {
        currentCategoryKey = catKey;
        openGalleryForCategory(catKey);
      });

      categoryList.appendChild(btn);
    });
  }

  // ----------------------------------------------------------
  // 第2画面：ギャラリー
  // ----------------------------------------------------------

  function openGalleryForCategory(catKey) {
    const cat = window.PHOTOS_INDEX.categories[catKey];
    const displayTitle = formatCategoryTitle(cat.title, catKey);

    galleryTitle.textContent = displayTitle;
    galleryContainer.innerHTML = "";

    const groups = cat.groups;
    const order = buildGroupOrder(groups);

    order.forEach((groupIndex) => {
      const group = groups[groupIndex];
      const photos = group.photos;

      const h3 = document.createElement("h3");
      h3.className = "gallery-group-title";
      h3.textContent = formatGroupTitle(group.name);
      galleryContainer.appendChild(h3);

      const subBlocks = splitPhotosBySubId(photos);

      if (!subBlocks) {
        const grid = document.createElement("div");
        grid.className = "gallery-grid";

        photos.forEach((photo, index) => {
          const t = document.createElement("div");
          t.className = "thumb";

          const img = document.createElement("img");
          img.src = photo.src;

          const file = document.createElement("div");
          file.className = "thumb-filename";
          file.textContent = formatDisplayFilename(photo.filename);

          t.appendChild(img);
          t.appendChild(file);

          t.addEventListener("click", () => {
            openViewer(catKey, groupIndex, index);
          });

          grid.appendChild(t);
        });

        galleryContainer.appendChild(grid);
      } else {
        subBlocks.forEach((block) => {
          const h4 = document.createElement("h4");
          h4.className = "gallery-subgroup-title";
          h4.textContent = `■ ${block.subId}`;
          galleryContainer.appendChild(h4);

          const grid = document.createElement("div");
          grid.className = "gallery-grid";

          block.items.forEach(({ photo, index }) => {
            const t = document.createElement("div");
            t.className = "thumb";

            const img = document.createElement("img");
            img.src = photo.src;

            const file = document.createElement("div");
            file.className = "thumb-filename";
            file.textContent = formatDisplayFilename(photo.filename);

            t.appendChild(img);
            t.appendChild(file);

            t.addEventListener("click", () => {
              openViewer(catKey, groupIndex, index);
            });

            grid.appendChild(t);
          });

          galleryContainer.appendChild(grid);
        });
      }
    });

    showScreen("gallery");
  }

  // ----------------------------------------------------------
  // 第3画面：拡大表示（修正版）
  // ----------------------------------------------------------

  function openViewer(catKey, groupIndex, photoIndex) {
    const categories = window.PHOTOS_INDEX.categories;
    const cat = categories[catKey];
    const group = cat.groups[groupIndex];
    const photo = group.photos[photoIndex];

    currentCategoryKey = catKey;
    currentGroupIndex = groupIndex;
    currentPhotoIndex = photoIndex;

    // 表示画像
    viewerImage.src = photo.src;
    viewerImage.alt = photo.filename || "";

    // カテゴリ名（番号除去）
    const displayTitle = formatCategoryTitle(cat.title, catKey);

    // グループ名（番号除去：例 1.9.集合写真 → 集合写真）
    const groupLabel = formatGroupLabelForContext(group.name);

    // subID（内部UI命名から抽出。X の場合は表示しない）
    const subId = extractSubIdFromFilename(photo.filename);

    // context を部品ごとに構成する
    const contextParts = [];
    if (displayTitle) contextParts.push(displayTitle);
    if (groupLabel) contextParts.push(groupLabel);
    if (subId && subId !== "X") contextParts.push(subId);

    // 表示ファイル名（001.jpg など）
    viewerFilename.textContent = formatDisplayFilename(photo.filename);

    // 「カテゴリ / グループ名 / サブフォルダID(あれば)」
    viewerContext.textContent = contextParts.join(" / ");

    showScreen("viewer");
  }

  // ----------------------------------------------------------
  // イベント設定
  // ----------------------------------------------------------

  function setupEventHandlers() {
    // 🏠 → 第1画面へ
    if (homeButton) {
      homeButton.addEventListener("click", () => {
        showScreen("category");
      });
    }

    // 🔙 → 第2画面へ（直前に開いていたカテゴリを再描画）
    if (backButton) {
      backButton.addEventListener("click", () => {
        if (currentCategoryKey) {
          openGalleryForCategory(currentCategoryKey);
        } else {
          showScreen("gallery");
        }
      });
    }
  }

  // ----------------------------------------------------------
  // 初期化
  // ----------------------------------------------------------

  function init() {
    screenCategory = document.getElementById("screen-category");
    screenGallery = document.getElementById("screen-gallery");
    screenViewer = document.getElementById("screen-viewer");

    categoryList = document.getElementById("category-list");
    galleryTitle = document.getElementById("gallery-title");
    galleryContainer = document.getElementById("gallery-container");

    viewerImage = document.getElementById("viewer-image");
    viewerFilename = document.getElementById("viewer-filename");
    viewerContext = document.getElementById("viewer-context");
    viewerCloseButton = document.getElementById("viewer-close-button");

    homeButton = document.getElementById("home-button");
    backButton = document.querySelector(".back-button"); // 🔙

    setupEventHandlers();
    renderCategoryList();
    showScreen("category");
  }

  document.addEventListener("DOMContentLoaded", init);
})();