const maxDays = 30;

async function genReportLog(container, reportConfig) {
  const response = await fetch(`logs/${reportConfig.logKey}_report.log`);
  let statusLines = "";
  if (response.ok) {
    statusLines = await response.text();
  }

  const normalized = normalizeData(statusLines);
  const statusStream = constructStatusStream(reportConfig, normalized);
  container.appendChild(statusStream);
}

function constructStatusStream(reportConfig, uptimeData) {
  let streamContainer = templatize("statusStreamContainerTemplate");

  for (var ii = maxDays - 1; ii >= 0; ii--) {
    let line = constructStatusLine(reportConfig.title, ii, uptimeData[ii]);
    streamContainer.appendChild(line);
  }

  const lastSet = uptimeData[0];
  const color = getColor(lastSet);

  const container = templatize("statusContainerTemplate", {
    title: reportConfig.title,
    url: reportConfig.url,
    color: color,
    status: getStatusText(color),
    upTime: uptimeData.upTime,
    details: reportConfig.details || "",
  });

  if (reportConfig.showUrl === false) {
    container.querySelector(".sectionUrl").remove();
  }

  if (!reportConfig.details) {
    container.querySelector(".statusMeta").remove();
  }

  container.appendChild(streamContainer);
  return container;
}

function constructStatusLine(key, relDay, upTimeArray) {
  let date = new Date();
  date.setDate(date.getDate() - relDay);

  return constructStatusSquare(key, date, upTimeArray);
}

function getColor(uptimeVal) {
  return uptimeVal == null
    ? "nodata"
    : uptimeVal == 1
    ? "success"
    : uptimeVal < 0.3
    ? "failure"
    : "partial";
}

function constructStatusSquare(key, date, uptimeVal) {
  const color = getColor(uptimeVal);
  let square = templatize("statusSquareTemplate", {
    color: color,
    tooltip: getTooltip(key, date, color),
  });

  const show = () => {
    showTooltip(square, key, date, color);
  };
  square.addEventListener("mouseover", show);
  square.addEventListener("mousedown", show);
  square.addEventListener("mouseout", hideTooltip);
  return square;
}

let cloneId = 0;
function templatize(templateId, parameters) {
  let clone = document.getElementById(templateId).cloneNode(true);
  clone.id = "template_clone_" + cloneId++;
  if (!parameters) {
    return clone;
  }

  applyTemplateSubstitutions(clone, parameters);
  return clone;
}

function applyTemplateSubstitutions(node, parameters) {
  const attributes = node.getAttributeNames();
  for (var ii = 0; ii < attributes.length; ii++) {
    const attr = attributes[ii];
    const attrVal = node.getAttribute(attr);
    node.setAttribute(attr, templatizeString(attrVal, parameters));
  }

  if (node.childElementCount == 0) {
    node.innerText = templatizeString(node.innerText, parameters);
  } else {
    const children = Array.from(node.children);
    children.forEach((n) => {
      applyTemplateSubstitutions(n, parameters);
    });
  }
}

function templatizeString(text, parameters) {
  if (parameters) {
    for (const [key, val] of Object.entries(parameters)) {
      text = text.replaceAll("$" + key, val);
    }
  }
  return text;
}

function getStatusText(color) {
  return color == "nodata"
    ? "No Data Available"
    : color == "success"
    ? "Fully Operational"
    : color == "failure"
    ? "Major Outage"
    : color == "partial"
    ? "Partial Outage"
    : "Unknown";
}

function getStatusDescriptiveText(color) {
  return color == "nodata"
    ? "No Data Available: Health check was not performed."
    : color == "success"
    ? "No downtime recorded on this day."
    : color == "failure"
    ? "Major outages recorded on this day."
    : color == "partial"
    ? "Partial outages recorded on this day."
    : "Unknown";
}

function getTooltip(key, date, quartile, color) {
  let statusText = getStatusText(color);
  return `${key} | ${date.toDateString()} : ${quartile} : ${statusText}`;
}

function normalizeData(statusLines) {
  const rows = statusLines.split("\n");
  const dateNormalized = splitRowsByDate(rows);

  let relativeDateMap = {};
  const now = Date.now();
  for (const [key, val] of Object.entries(dateNormalized)) {
    if (key == "upTime") {
      continue;
    }

    const relDays = getRelativeDays(now, new Date(key).getTime());
    relativeDateMap[relDays] = getDayAverage(val);
  }

  relativeDateMap.upTime = dateNormalized.upTime;
  return relativeDateMap;
}

function getDayAverage(val) {
  if (!val || val.length == 0) {
    return null;
  } else {
    return val.reduce((a, v) => a + v) / val.length;
  }
}

function getRelativeDays(date1, date2) {
  return Math.floor(Math.abs((date1 - date2) / (24 * 3600 * 1000)));
}

function splitRowsByDate(rows) {
  let dateValues = {};
  let sum = 0,
    count = 0;
  for (var ii = 0; ii < rows.length; ii++) {
    const row = rows[ii];
    if (!row) {
      continue;
    }

    const [dateTimeStr, resultStr] = row.split(",", 2);
    const dateTime = new Date(
      Date.parse(dateTimeStr.replace(/-/g, "/") + " GMT")
    );
    const dateStr = dateTime.toDateString();

    let resultArray = dateValues[dateStr];
    if (!resultArray) {
      resultArray = [];
      dateValues[dateStr] = resultArray;
    }

    let result = 0;
    if (resultStr.trim() == "success") {
      result = 1;
    } else if (resultStr.trim() == "partial") {
      result = 0.5;
    }
    sum += result;
    count++;

    resultArray.push(result);
  }

  const upTime = count ? ((sum / count) * 100).toFixed(2) + "%" : "--%";
  dateValues.upTime = upTime;
  return dateValues;
}

let tooltipTimeout = null;
function showTooltip(element, key, date, color) {
  clearTimeout(tooltipTimeout);
  const toolTipDiv = document.getElementById("tooltip");

  document.getElementById("tooltipDateTime").innerText = date.toDateString();
  document.getElementById("tooltipDescription").innerText =
    getStatusDescriptiveText(color);

  const statusDiv = document.getElementById("tooltipStatus");
  statusDiv.innerText = getStatusText(color);
  statusDiv.className = color;

  toolTipDiv.style.top = element.offsetTop + element.offsetHeight + 10;
  toolTipDiv.style.left =
    element.offsetLeft + element.offsetWidth / 2 - toolTipDiv.offsetWidth / 2;
  toolTipDiv.style.opacity = "1";
}

function hideTooltip() {
  tooltipTimeout = setTimeout(() => {
    const toolTipDiv = document.getElementById("tooltip");
    toolTipDiv.style.opacity = "0";
  }, 1000);
}

function titleizeKey(value) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function parseConfigLine(configLine) {
  const separatorIndex = configLine.indexOf("=");
  if (separatorIndex === -1) {
    return null;
  }

  const key = configLine.slice(0, separatorIndex).trim();
  const url = configLine.slice(separatorIndex + 1).trim();
  if (!key || !url) {
    return null;
  }

  return {
    key: key,
    title: titleizeKey(key),
    url: url,
  };
}

async function fetchServiceManifest(key) {
  try {
    const response = await fetch(`logs/${key}_services.json`);
    if (!response.ok) {
      return [];
    }

    const serviceData = await response.json();
    return Array.isArray(serviceData) ? serviceData : [];
  } catch {
    return [];
  }
}

function buildServiceDetails(service) {
  const details = [];
  if (service.statusCode != null) {
    details.push(`Status code: ${service.statusCode}`);
  }

  return details.join(" | ");
}

function normalizeService(service) {
  if (typeof service === "string") {
    return {
      key: service,
      title: titleizeKey(service),
      details: "",
    };
  }

  return {
    key: service.key,
    title: service.title || titleizeKey(service.key),
    details: buildServiceDetails(service),
  };
}

async function genReportGroup(container, reportConfig) {
  const services = await fetchServiceManifest(reportConfig.key);
  if (!services.length) {
    await genReportLog(container, {
      logKey: reportConfig.key,
      title: reportConfig.title,
      url: reportConfig.url,
      details: "",
      showUrl: true,
    });
    return;
  }

  const groupContainer = templatize("reportGroupTemplate", {
    title: reportConfig.title,
    url: reportConfig.url,
  });
  container.appendChild(groupContainer);

  for (let ii = 0; ii < services.length; ii++) {
    const service = normalizeService(services[ii]);
    await genReportLog(groupContainer, {
      logKey: `${reportConfig.key}__${service.key}`,
      title: service.title,
      url: reportConfig.url,
      details: service.details,
      showUrl: false,
    });
  }
}

async function genAllReports() {
  const response = await fetch("urls.cfg");
  const configText = await response.text();
  const configLines = configText.split("\n");
  for (let ii = 0; ii < configLines.length; ii++) {
    const reportConfig = parseConfigLine(configLines[ii]);
    if (!reportConfig) {
      continue;
    }

    await genReportGroup(document.getElementById("reports"), reportConfig);
  }
}
