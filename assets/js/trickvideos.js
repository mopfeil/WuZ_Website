// Video links on the trick pages (/Z/, /C/, /I/ …), unlisted YouTube videos.
// Enter the video ID (the part after "watch?v=" or "youtu.be/").
// A page shows only the links that have an ID; with none, the block stays hidden.
(function () {
  var INTRO = "";              // Einleitungsvideo Wissenschaft & Zauberkunst
  var VIDEOS = {
    Z: "PTe0kkg2Yyg", P: "OESKTOXCUjA", C: "EWPEpj-YEO8", H: "", N: "", A: "", E: "", M: "", W: "", I: ""
  };

  var box = document.querySelector(".trick-videos[data-trick]");
  if (!box) return;
  var en = document.documentElement.lang === "en";
  var links = [];
  var id = VIDEOS[box.getAttribute("data-trick")];
  if (id) links.push([id, en ? "Watch the video of this trick" : "Video zu diesem Kunststück"]);
  if (INTRO) links.push([INTRO, en ? "Introduction to Science & Magic" : "Einleitungsvideo Wissenschaft & Zauberkunst"]);
  if (!links.length) return;
  links.forEach(function (l) {
    var a = document.createElement("a");
    a.className = "btn btn-navy";
    a.href = "https://www.youtube.com/watch?v=" + encodeURIComponent(l[0]);
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = "▶ " + l[1];
    box.appendChild(a);
  });
  box.hidden = false;
})();
