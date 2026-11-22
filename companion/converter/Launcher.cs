using System;
using System.IO;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Windows.Forms;
using System.Collections.Generic;
using System.IO.Compression;

public static class StudioLauncher {
 [STAThread] public static int Main(string[] args) {
  if(args.Length>0 && args[0]=="--convert")return Program.Main(args[1..]);
  if(args.Length==3 && args[0]=="--project")return SurfaceProjection.Run(args[1],args[2]);
  if(args.Length==3 && args[0]=="--pack-brotli"){
   using var input=File.OpenRead(args[1]);using var file=File.Create(args[2]);using var packedStream=new BrotliStream(file,CompressionLevel.Optimal);input.CopyTo(packedStream);return 0;
  }
  ApplicationConfiguration.Initialize();
  using var window=new Form{Text="WOG — 3D-планировщик",Width=800,Height=670,MinimumSize=new System.Drawing.Size(650,550)};
  var layout=new FlowLayoutPanel{Dock=DockStyle.Fill,FlowDirection=FlowDirection.TopDown,WrapContents=false,AutoScroll=true,Padding=new Padding(16)};
  window.Controls.Add(layout);
  var folders=new List<string>();
  var log=new TextBox{Multiline=true,ReadOnly=true,ScrollBars=ScrollBars.Vertical,Width=735,Height=240};
  var info=new Label{Text="Откройте PBO миссии. Добавьте папку игры и папки модов вашей сборки.",AutoSize=true};layout.Controls.Add(info);
  Button button(string title){var b=new Button{Text=title,Width=735,Height=38};layout.Controls.Add(b);return b;}
  var open=button("Открыть файл миссии");
  var add=button("Добавить папку Arma 3 / модов");
  var quality=new ComboBox{DropDownStyle=ComboBoxStyle.DropDownList,Width=200};quality.Items.AddRange(new object[]{"Низкий","Средний","Высокий"});quality.SelectedIndex=1;
  layout.Controls.Add(new Label{Text="Качество моделей и текстур",AutoSize=true});layout.Controls.Add(quality);
  var improve=button("Подготовить модели и параметры из сборки");var restore=button("Вернуть модели сайта");
  layout.Controls.Add(new Label{Text="Игра и моды не изменяются. Модели техники и окружения, их текстуры читаются из сборки.\nПараметры движения и места берутся из конфигов. Интернет нужен для новых карт.",AutoSize=true});layout.Controls.Add(log);
  Process worker=null;
  void output(string line){if(window.IsDisposed||!window.IsHandleCreated)return;window.BeginInvoke((Action)(()=>{if(line=="@@done"){improve.Enabled=true;open.Enabled=true;restore.Enabled=true;}else log.AppendText(line+Environment.NewLine);}));}
  void send(object value){try{worker.StandardInput.WriteLine(JsonSerializer.Serialize(value));worker.StandardInput.Flush();}catch(Exception e){MessageBox.Show(e.Message,"Ошибка утилиты");}}
  window.Shown+=(_,_)=>{
   try{var start=new ProcessStartInfo(Path.Combine(AppContext.BaseDirectory,"WOG-Planner-Worker.exe"),"--worker"){UseShellExecute=false,CreateNoWindow=true,RedirectStandardInput=true,RedirectStandardOutput=true,RedirectStandardError=true,StandardOutputEncoding=Encoding.UTF8,StandardErrorEncoding=Encoding.UTF8};start.Environment["PYTHONIOENCODING"]="utf-8";
    worker=new Process{StartInfo=start,EnableRaisingEvents=true};worker.OutputDataReceived+=(_,e)=>{if(e.Data!=null)output(e.Data);};worker.ErrorDataReceived+=(_,e)=>{if(e.Data!=null)output(e.Data);};worker.Start();worker.BeginOutputReadLine();worker.BeginErrorReadLine();
   }catch(Exception e){MessageBox.Show(e.Message,"Не удалось запустить утилиту");window.Close();}
  };
  open.Click+=(_,_)=>{using var dialog=new OpenFileDialog{Filter="Миссия Arma 3|*.pbo"};if(dialog.ShowDialog()==DialogResult.OK)send(new{open=dialog.FileName});};
  add.Click+=(_,_)=>{using var dialog=new FolderBrowserDialog{Description="Папка Arma 3 или модов",UseDescriptionForTitle=true};if(dialog.ShowDialog()==DialogResult.OK&&!folders.Contains(dialog.SelectedPath)){folders.Add(dialog.SelectedPath);log.AppendText("Добавлена папка: "+dialog.SelectedPath+Environment.NewLine);}};
  improve.Click+=(_,_)=>{if(folders.Count==0){MessageBox.Show("Выберите папку игры или модов.");return;}improve.Enabled=false;open.Enabled=false;restore.Enabled=false;send(new{upgrade=folders.ToArray(),quality=new[]{"low","medium","high"}[quality.SelectedIndex]});};
  restore.Click+=(_,_)=>send(new{restore=true});
  window.FormClosed+=(_,_)=>{try{worker?.StandardInput.Close();if(worker!=null&&!worker.WaitForExit(1500))worker.Kill(true);}catch{}};
  Application.Run(window);worker?.Dispose();return 0;
 }
}
