import {
  MarkdownView,
  Plugin,
  Editor,
  Menu,
  MenuItem,
  TFile,
  normalizePath,
  Notice,
  addIcon,
  MarkdownFileInfo,
  requestUrl,
} from "obsidian";
import { resolve, basename, dirname, join, parse, relative } from "path-browserify";

import { isAssetTypeAnImage, arrayToObject, getUrlAsset, uuid } from "./utils";
import { downloadAllImageFiles } from "./download";
import { UploaderManager } from "./uploader/index";
import { PicGoDeleter } from "./deleter";
import Helper from "./helper";
import { t } from "./lang/helpers";
import { SettingTab, PluginSettings, DEFAULT_SETTINGS } from "./setting";

import type { Image } from "./types";

export default class imageAutoUploadPlugin extends Plugin {
  settings: PluginSettings;
  helper: Helper;
  editor: Editor;
  picGoDeleter: PicGoDeleter;

  async loadSettings() {
    this.settings = Object.assign(DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  onunload() {}

  async onload() {
    await this.loadSettings();

    this.helper = new Helper(this.app);
    this.picGoDeleter = new PicGoDeleter(this);

    addIcon(
      "upload",
      `<svg t="1636630783429" class="icon" viewBox="0 0 100 100" version="1.1" p-id="4649" xmlns="http://www.w3.org/2000/svg">
      <path d="M 71.638 35.336 L 79.408 35.336 C 83.7 35.336 87.178 38.662 87.178 42.765 L 87.178 84.864 C 87.178 88.969 83.7 92.295 79.408 92.295 L 17.249 92.295 C 12.957 92.295 9.479 88.969 9.479 84.864 L 9.479 42.765 C 9.479 38.662 12.957 35.336 17.249 35.336 L 25.019 35.336 L 25.019 42.765 L 17.249 42.765 L 17.249 84.864 L 79.408 84.864 L 79.408 42.765 L 71.638 42.765 L 71.638 35.336 Z M 49.014 10.179 L 67.326 27.688 L 61.835 32.942 L 52.849 24.352 L 52.849 59.731 L 45.078 59.731 L 45.078 24.455 L 36.194 32.947 L 30.702 27.692 L 49.012 10.181 Z" p-id="4650" fill="#8a8a8a"></path>
    </svg>`
    );

    this.addSettingTab(new SettingTab(this.app, this));

    this.addCommand({
      id: "Upload all images_dev",
      name: "Upload all images_dev",
      checkCallback: (checking: boolean) => {
        let leaf = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (leaf) {
          if (!checking) {
            this.uploadAllFile();
          }
          return true;
        }
        return false;
      },
    });
    this.addCommand({
      id: "Download all images",
      name: "Download all images",
      checkCallback: (checking: boolean) => {
        let leaf = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (leaf) {
          if (!checking) {
            downloadAllImageFiles(this);
          }
          return true;
        }
        return false;
      },
    });

    this.addCommand({
      id: "Batch upload folder images",
      name: "Batch upload folder images",
      checkCallback: (checking: boolean) => {
        let leaf = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (leaf) {
          if (!checking) {
            this.batchUploadFolderImages();
          }
          return true;
        }
        return false;
      },
    });

    this.addCommand({
      id: "Batch download folder images",
      name: "Batch download folder images", 
      checkCallback: (checking: boolean) => {
        let leaf = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (leaf) {
          if (!checking) {
            this.batchDownloadFolderImages();
          }
          return true;
        }
        return false;
      },
    });
    this.setupPasteHandler();
    this.registerFileMenu();
    this.registerSelection();
  }

  /**
   * 获取当前使用的上传器
   */
  getUploader() {
    const uploader = new UploaderManager(this.settings.uploader, this);

    return uploader;
  }

  /**
   * 上传图片
   */
  upload(images: Image[] | string[]) {
    let uploader = this.getUploader();
    return uploader.upload(images);
  }

  /**
   * 通过剪贴板上传图片
   */
  uploadByClipboard(fileList?: FileList) {
    let uploader = this.getUploader();
    return uploader.uploadByClipboard(fileList);
  }

  registerSelection() {
    this.registerEvent(
      this.app.workspace.on(
        "editor-menu",
        (menu: Menu, editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
          if (this.app.workspace.getLeavesOfType("markdown").length === 0) {
            return;
          }
          const selection = editor.getSelection();
          if (selection) {
            const markdownRegex = /!\[.*\]\((.*)\)/g;
            const markdownMatch = markdownRegex.exec(selection);
            if (markdownMatch && markdownMatch.length > 1) {
              const markdownUrl = markdownMatch[1];
              if (
                this.settings.uploadedImages.find(
                  (item: { imgUrl: string }) => item.imgUrl === markdownUrl
                )
              ) {
                this.addRemoveMenu(menu, markdownUrl, editor);
              }
            }
          }
        }
      )
    );
  }

  addRemoveMenu = (menu: Menu, imgPath: string, editor: Editor) => {
    menu.addItem((item: MenuItem) =>
      item
        .setIcon("trash-2")
        .setTitle(t("Delete image using PicList"))
        .onClick(async () => {
          try {
            const selectedItem = this.settings.uploadedImages.find(
              (item: { imgUrl: string }) => item.imgUrl === imgPath
            );
            if (selectedItem) {
              const res = await this.picGoDeleter.deleteImage([selectedItem]);
              if (res.success) {
                new Notice(t("Delete successfully"));
                const selection = editor.getSelection();
                if (selection) {
                  editor.replaceSelection("");
                }
                this.settings.uploadedImages =
                  this.settings.uploadedImages.filter(
                    (item: { imgUrl: string }) => item.imgUrl !== imgPath
                  );
                this.saveSettings();
              } else {
                new Notice(t("Delete failed"));
              }
            }
          } catch {
            new Notice(t("Error, could not delete"));
          }
        })
    );
  };

  registerFileMenu() {
    this.registerEvent(
      this.app.workspace.on(
        "file-menu",
        (menu: Menu, file: TFile, source: string, leaf) => {
          if (source === "canvas-menu") return false;
          if (!isAssetTypeAnImage(file.path)) return false;

          menu.addItem((item: MenuItem) => {
            item
              .setTitle(t("upload"))
              .setIcon("upload")
              .onClick(() => {
                if (!(file instanceof TFile)) {
                  return false;
                }
                this.fileMenuUpload(file);
              });
          });
        }
      )
    );
  }

  fileMenuUpload(file: TFile) {
    let imageList: Image[] = [];
    const fileArray = this.helper.getAllFiles();

    for (const match of fileArray) {
      const imageName = match.name;
      const encodedUri = match.path;

      const fileName = basename(decodeURI(encodedUri));

      if (file && file.name === fileName) {
        if (isAssetTypeAnImage(file.path)) {
          imageList.push({
            path: file.path,
            name: imageName,
            source: match.source,
            file: file,
          });
        }
      }
    }

    if (imageList.length === 0) {
      new Notice(t("Can not find image file"));
      return;
    }

    this.upload(imageList).then(res => {
      if (!res.success) {
        new Notice("Upload error");
        return;
      }

      let uploadUrlList = res.result;
      this.replaceImage(imageList, uploadUrlList);
    });
  }

  filterFile(fileArray: Image[]) {
    const imageList: Image[] = [];

    for (const match of fileArray) {
      if (match.path.startsWith("http")) {
        if (this.settings.workOnNetWork) {
          if (
            !this.helper.hasBlackDomain(
              match.path,
              this.settings.newWorkBlackDomains
            )
          ) {
            imageList.push({
              path: match.path,
              name: match.name,
              source: match.source,
            });
          }
        }
      } else {
        imageList.push({
          path: match.path,
          name: match.name,
          source: match.source,
        });
      }
    }

    return imageList;
  }

  /**
   * 替换上传的图片
   */
  replaceImage(imageList: Image[], uploadUrlList: string[]) {
    let content = this.helper.getValue();

    imageList.map(item => {
      const uploadImage = uploadUrlList.shift();

      let name = this.handleName(item.name);
      content = content.replaceAll(item.source, `![${name}](${uploadImage})`);
    });

    this.helper.setValue(content);

    if (this.settings.deleteSource) {
      imageList.map(image => {
        if (image.file && !image.path.startsWith("http")) {
          this.app.fileManager.trashFile(image.file);
        }
      });
    }
  }

  /**
   * 上传所有图片
   */
  uploadAllFile() {
    const activeFile = this.app.workspace.getActiveFile();
    const fileMap = arrayToObject(this.app.vault.getFiles(), "name");
    const filePathMap = arrayToObject(this.app.vault.getFiles(), "path");
    let imageList: (Image & { file: TFile | null })[] = [];
    const fileArray = this.filterFile(this.helper.getAllFiles());

    for (const match of fileArray) {
      const imageName = match.name;
      const uri = decodeURI(match.path);
      
      if (uri.startsWith("http")) {
        imageList.push({
          path: match.path,
          name: imageName,
          source: match.source,
          file: null,
        });
      } else {
        const fileName = basename(uri);
        let file: TFile | undefined | null;
        // 优先匹配绝对路径
        if (filePathMap[uri]) {
          file = filePathMap[uri];
        }

        // 相对路径
        if ((!file && uri.startsWith("./")) || uri.startsWith("../")) {
          const filePath = normalizePath(
            resolve(dirname(activeFile.path), uri)
          );

          file = filePathMap[filePath];
        }

        // 尽可能短路径
        if (!file) {
          file = fileMap[fileName];
        }

        if (file) {
          if (isAssetTypeAnImage(file.path)) {
            imageList.push({
              path: normalizePath(file.path),
              name: imageName,
              source: match.source,
              file: file,
            });
          }
        }
      }
    }

    if (imageList.length === 0) {
      new Notice(t("Can not find image file"));
      return;
    } else {
      new Notice(`Have found ${imageList.length} images`);
    }

    this.upload(imageList).then(res => {
      let uploadUrlList = res.result;
      if (imageList.length !== uploadUrlList.length) {
        new Notice(
          t("Warning: upload files is different of reciver files from api")
        );
        return;
      }
      const currentFile = this.app.workspace.getActiveFile();
      if (activeFile.path !== currentFile.path) {
        new Notice(t("File has been changedd, upload failure"));
        return;
      }

      this.replaceImage(imageList, uploadUrlList);
    });
  }

  setupPasteHandler() {
    this.registerEvent(
      this.app.workspace.on(
        "editor-paste",
        (evt: ClipboardEvent, editor: Editor, markdownView: MarkdownView) => {
          const allowUpload = this.helper.getFrontmatterValue(
            "image-auto-upload",
            this.settings.uploadByClipSwitch
          );

          let files = evt.clipboardData.files;
          if (!allowUpload) {
            return;
          }

          // 剪贴板内容有md格式的图片时
          if (this.settings.workOnNetWork) {
            const clipboardValue = evt.clipboardData.getData("text/plain");
            const imageList = this.helper
              .getImageLink(clipboardValue)
              .filter(image => image.path.startsWith("http"))
              .filter(
                image =>
                  !this.helper.hasBlackDomain(
                    image.path,
                    this.settings.newWorkBlackDomains
                  )
              );

            if (imageList.length !== 0) {
              this.upload(imageList).then(res => {
                let uploadUrlList = res.result;
                this.replaceImage(imageList, uploadUrlList);
              });
            }
          }

          // 剪贴板中是图片时进行上传
          if (this.canUpload(evt.clipboardData)) {
            this.uploadFileAndEmbedImgurImage(
              editor,
              async (editor: Editor, pasteId: string) => {
                let res: any;
                res = await this.uploadByClipboard(evt.clipboardData.files);

                if (res.code !== 0) {
                  this.handleFailedUpload(editor, pasteId, res.msg);
                  return;
                }
                const url = res.data;

                return url;
              },
              evt.clipboardData
            ).catch();
            evt.preventDefault();
          }
        }
      )
    );
    this.registerEvent(
      this.app.workspace.on(
        "editor-drop",
        async (evt: DragEvent, editor: Editor, markdownView: MarkdownView) => {
          // when ctrl key is pressed, do not upload image, because it is used to set local file
          if (evt.ctrlKey) {
            return;
          }
          const allowUpload = this.helper.getFrontmatterValue(
            "image-auto-upload",
            this.settings.uploadByClipSwitch
          );

          if (!allowUpload) {
            return;
          }

          let files = evt.dataTransfer.files;
          if (files.length !== 0 && files[0].type.startsWith("image")) {
            let sendFiles: Array<string> = [];
            let files = evt.dataTransfer.files;
            Array.from(files).forEach((item, index) => {
              if (item.path) {
                sendFiles.push(item.path);
              } else {
                const { webUtils } = require("electron");
                const path = webUtils.getPathForFile(item);
                sendFiles.push(path);
              }
            });
            evt.preventDefault();

            const data = await this.upload(sendFiles);

            if (data.success) {
              data.result.map((value: string) => {
                let pasteId = (Math.random() + 1).toString(36).substr(2, 5);
                this.insertTemporaryText(editor, pasteId);
                this.embedMarkDownImage(editor, pasteId, value, files[0].name);
              });
            } else {
              new Notice("Upload error");
            }
          }
        }
      )
    );
  }

  canUpload(clipboardData: DataTransfer) {
    this.settings.applyImage;
    const files = clipboardData.files;
    const text = clipboardData.getData("text");

    const hasImageFile =
      files.length !== 0 && files[0].type.startsWith("image");
    if (hasImageFile) {
      if (!!text) {
        return this.settings.applyImage;
      } else {
        return true;
      }
    } else {
      return false;
    }
  }

  async uploadFileAndEmbedImgurImage(
    editor: Editor,
    callback: Function,
    clipboardData: DataTransfer
  ) {
    let pasteId = (Math.random() + 1).toString(36).substr(2, 5);
    this.insertTemporaryText(editor, pasteId);
    const name = clipboardData.files[0].name;

    try {
      const url = await callback(editor, pasteId);
      this.embedMarkDownImage(editor, pasteId, url, name);
    } catch (e) {
      this.handleFailedUpload(editor, pasteId, e);
    }
  }

  insertTemporaryText(editor: Editor, pasteId: string) {
    let progressText = imageAutoUploadPlugin.progressTextFor(pasteId);
    editor.replaceSelection(progressText + "\n");
  }

  private static progressTextFor(id: string) {
    return `![Uploading file...${id}]()`;
  }

  embedMarkDownImage(
    editor: Editor,
    pasteId: string,
    imageUrl: any,
    name: string = ""
  ) {
    let progressText = imageAutoUploadPlugin.progressTextFor(pasteId);
    name = this.handleName(name);

    let markDownImage = `![${name}](${imageUrl})`;

    imageAutoUploadPlugin.replaceFirstOccurrence(
      editor,
      progressText,
      markDownImage
    );
  }

  handleFailedUpload(editor: Editor, pasteId: string, reason: any) {
    new Notice(reason);
    console.error("Failed request: ", reason);
    let progressText = imageAutoUploadPlugin.progressTextFor(pasteId);
    imageAutoUploadPlugin.replaceFirstOccurrence(
      editor,
      progressText,
      "⚠️upload failed, check dev console"
    );
  }

  handleName(name: string) {
    const imageSizeSuffix = this.settings.imageSizeSuffix || "";

    if (this.settings.imageDesc === "origin") {
      return `${name}${imageSizeSuffix}`;
    } else if (this.settings.imageDesc === "none") {
      return "";
    } else if (this.settings.imageDesc === "removeDefault") {
      if (name === "image.png") {
        return "";
      } else {
        return `${name}${imageSizeSuffix}`;
      }
    } else {
      return `${name}${imageSizeSuffix}`;
    }
  }

  static replaceFirstOccurrence(
    editor: Editor,
    target: string,
    replacement: string
  ) {
    let lines = editor.getValue().split("\n");
    for (let i = 0; i < lines.length; i++) {
      let ch = lines[i].indexOf(target);
      if (ch != -1) {
        let from = { line: i, ch: ch };
        let to = { line: i, ch: ch + target.length };
        editor.replaceRange(replacement, from, to);
        break;
      }
    }
  }

  /**
   * 批量上传文件夹中所有Markdown文件的图片
   */
  async batchUploadFolderImages() {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice("No active file");
      return;
    }

    const currentFolder = activeFile.parent;
    if (!currentFolder) {
      new Notice("Cannot determine current folder");
      return;
    }

    // 获取文件夹中的所有Markdown文件
    const markdownFiles = currentFolder.children.filter(
      file => file instanceof TFile && file.extension === 'md'
    ) as TFile[];

    if (markdownFiles.length === 0) {
      new Notice("No markdown files found in current folder");
      return;
    }

    let totalProcessed = 0;
    let totalSuccess = 0;
    let totalImages = 0;

    new Notice(`开始处理 ${markdownFiles.length} 个文件...`);

    for (const file of markdownFiles) {
      try {
        // 临时切换到当前处理的文件
        const leaf = this.app.workspace.getLeaf();
        await leaf.openFile(file);
        
        // 获取该文件的所有图片
        const fileContent = await this.app.vault.read(file);
        const imageList = this.filterFile(this.helper.getImageLink(fileContent));
        
        if (imageList.length === 0) {
          totalProcessed++;
          continue;
        }

        totalImages += imageList.length;
        
        // 处理图片路径和文件对象
        const processedImages = await this.processImagesForFile(file, imageList);
        
        if (processedImages.length > 0) {
          // 执行上传
          try {
            const uploadResult = await this.upload(processedImages);
            if (uploadResult.success) {
              // 替换文件中的图片链接
              await this.replaceImageInFile(file, processedImages, uploadResult.result);
              totalSuccess += processedImages.length;
              new Notice(`${file.name}: 上传成功 ${processedImages.length} 张图片`);
            } else {
              new Notice(`${file.name}: 上传失败`);
            }
          } catch (error) {
            console.error("Upload error for file:", file.name, error);
            new Notice(`${file.name}: 上传出错`);
          }
        }
        
        totalProcessed++;
      } catch (error) {
        console.error("Error processing file:", file.name, error);
        new Notice(`处理文件 ${file.name} 时出错`);
        totalProcessed++;
      }
    }

    // 切换回原始文件
    const leaf = this.app.workspace.getLeaf();
    await leaf.openFile(activeFile);

    new Notice(
      `批量上传完成!\n处理文件: ${totalProcessed}/${markdownFiles.length}\n总图片: ${totalImages}\n成功上传: ${totalSuccess}`
    );
  }

  /**
   * 批量下载文件夹中所有Markdown文件的网络图片
   */
  async batchDownloadFolderImages() {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice("No active file");
      return;
    }

    const currentFolder = activeFile.parent;
    if (!currentFolder) {
      new Notice("Cannot determine current folder");
      return;
    }

    // 获取文件夹中的所有Markdown文件
    const markdownFiles = currentFolder.children.filter(
      file => file instanceof TFile && file.extension === 'md'
    ) as TFile[];

    if (markdownFiles.length === 0) {
      new Notice("No markdown files found in current folder");
      return;
    }

    let totalProcessed = 0;
    let totalSuccess = 0;
    let totalImages = 0;

    new Notice(`开始处理 ${markdownFiles.length} 个文件...`);

    // 创建下载目录
    const folderPath = await this.app.fileManager.getAvailablePathForAttachment("");
    if (!(await this.app.vault.adapter.exists(folderPath))) {
      await this.app.vault.adapter.mkdir(folderPath);
    }

    for (const file of markdownFiles) {
      try {
        // 读取文件内容
        const fileContent = await this.app.vault.read(file);
        const imageList = this.helper.getImageLink(fileContent);
        
        // 只处理网络图片
        const networkImages = imageList.filter(img => img.path.startsWith("http"));
        
        if (networkImages.length === 0) {
          totalProcessed++;
          continue;
        }

        totalImages += networkImages.length;
        
        // 下载图片并替换链接
        const downloadResults = await this.downloadImagesForFile(file, networkImages, folderPath);
        
        if (downloadResults.length > 0) {
          // 替换文件中的图片链接
          let newContent = fileContent;
          downloadResults.forEach(result => {
            const name = this.handleName(result.name);
            newContent = newContent.replace(result.source, `![${name}](${encodeURI(result.path)})`);
          });
          
          await this.app.vault.modify(file, newContent);
          totalSuccess += downloadResults.length;
          new Notice(`${file.name}: 下载成功 ${downloadResults.length} 张图片`);
        }
        
        totalProcessed++;
      } catch (error) {
        console.error("Error processing file:", file.name, error);
        new Notice(`处理文件 ${file.name} 时出错`);
        totalProcessed++;
      }
    }

    new Notice(
      `批量下载完成!\n处理文件: ${totalProcessed}/${markdownFiles.length}\n总图片: ${totalImages}\n成功下载: ${totalSuccess}`
    );
  }

  /**
   * 为特定文件处理图片对象
   */
  private async processImagesForFile(file: TFile, imageList: Image[]) {
    const fileMap = arrayToObject(this.app.vault.getFiles(), "name");
    const filePathMap = arrayToObject(this.app.vault.getFiles(), "path");
    const processedImages: (Image & { file: TFile | null })[] = [];

    for (const match of imageList) {
      const uri = decodeURI(match.path);
      
      if (uri.startsWith("http")) {
        processedImages.push({
          path: match.path,
          name: match.name,
          source: match.source,
          file: null,
        });
      } else {
        // 处理本地文件路径（相对于当前处理的文件）
        const fileName = basename(uri);
        let targetFile: TFile | undefined | null;
        
        // 优先匹配绝对路径
        if (filePathMap[uri]) {
          targetFile = filePathMap[uri];
        }
        
        // 相对路径处理
        if ((!targetFile && uri.startsWith("./")) || uri.startsWith("../")) {
          const filePath = normalizePath(
            resolve(dirname(file.path), uri)
          );
          targetFile = filePathMap[filePath];
        }
        
        // 尽可能短路径
        if (!targetFile) {
          targetFile = fileMap[fileName];
        }
        
        if (targetFile && isAssetTypeAnImage(targetFile.path)) {
          processedImages.push({
            path: normalizePath(targetFile.path),
            name: match.name,
            source: match.source,
            file: targetFile,
          });
        }
      }
    }

    return processedImages;
  }

  /**
   * 替换文件中的图片链接
   */
  private async replaceImageInFile(file: TFile, imageList: Image[], uploadUrlList: string[]) {
    let content = await this.app.vault.read(file);
    
    imageList.forEach((item, index) => {
      const uploadUrl = uploadUrlList[index];
      if (uploadUrl) {
        const name = this.handleName(item.name);
        content = content.replaceAll(item.source, `![${name}](${uploadUrl})`);
      }
    });
    
    await this.app.vault.modify(file, content);
    
    // 如果需要删除源文件
    if (this.settings.deleteSource) {
      imageList.forEach(image => {
        if (image.file && !image.path.startsWith("http")) {
          this.app.fileManager.trashFile(image.file);
        }
      });
    }
  }

  /**
   * 为特定文件下载图片
   */
  private async downloadImagesForFile(file: TFile, networkImages: Image[], folderPath: string) {
    const downloadResults = [];
    
    for (const image of networkImages) {
      try {
        const url = image.path;
        const asset = getUrlAsset(url);
        let name = decodeURI(parse(asset).name).replaceAll(/[\\\\/:*?\"<>|]/g, "-");
        
        const response = await this.downloadImage(url, folderPath, name);
        if (response.ok) {
          const relativePath = normalizePath(
            relative(normalizePath(file.parent.path), normalizePath(response.path))
          );
          
          downloadResults.push({
            source: image.source,
            name: name,
            path: relativePath,
          });
        }
      } catch (error) {
        console.error("Download error for image:", image.path, error);
      }
    }
    
    return downloadResults;
  }

  /**
   * 下载单个图片
   */
  private async downloadImage(url: string, folderPath: string, name: string) {
    try {
      const response = await requestUrl({ url });
      
      if (response.status !== 200) {
        return { ok: false, msg: "HTTP error" };
      }
      
      // 简单的图片类型检测，基于URL扩展名
      const urlExt = url.split('.').pop()?.toLowerCase();
      const validExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'];
      const ext = validExts.includes(urlExt) ? urlExt : 'jpg';
      
      let path = normalizePath(join(folderPath, `${name}.${ext}`));
      
      // 如果文件名已存在，则用随机值替换
      if (await this.app.vault.adapter.exists(path)) {
        path = normalizePath(join(folderPath, `${uuid()}.${ext}`));
      }
      
      await this.app.vault.adapter.writeBinary(path, response.arrayBuffer);
      return {
        ok: true,
        msg: "ok",
        path: path,
        type: { ext },
      };
    } catch (err) {
      return {
        ok: false,
        msg: err,
      };
    }
  }
}
