import java.util.*;

public class Main {
    public static void main(String[] args) {
        Scanner scanner = new Scanner(System.in);
        List<Double> numeros = new ArrayList<>();
        System.out.println("Insira os números (para terminar, inserir um ponto final):");
        // le os números do utilizador até encontrar um ponto final
        while (true) {
            String input = scanner.nextLine().trim();
            if (input.equals(".")) {
                break;
            }
            try {
                double num = Double.parseDouble(input);
                numeros.add(num);
            } catch (NumberFormatException e) {
                System.out.println("Entrada inválida. Por favor, insira uma sequência de números ou um ponto final caso pretenda terminar.");
            }
        }
        // verifica se a listade números está vazia
        if (numeros.isEmpty()) {
            System.out.println("Nenhum número foi inserido.");
            return;
        }
        // calcula a média
        double media = NumberUtils.calcularMedia(numeros);
        System.out.println("Média: " + media);

        // calcula a mediana (numero do meio)
        double mediana = NumberUtils.calcularMediana(numeros);
        System.out.println("Mediana: " + mediana);

        // obtém a moda
        ModaResultado modaResultado = NumberUtils.calcularModa(numeros);
        List<Double> moda = ModaResultado.getModa();
        if (moda.isEmpty()) { //se cada número aparecer apenas 1x
            System.out.println("Moda: Não existe. Cada elemento aparece apenas 1 vez.");
        } else { //o numero que aparece mais vezes é a moda, caso apareça mais que 1x
            System.out.println("Moda: " + moda + " - " + modaResultado.getFreqMaxima() + "x");
        }
        // ordena a lista em ordem crescente ou decrescente
        List<Double> numerosCrescente = new ArrayList<>(numeros);
    // opção de ordenar por ordem crescente,decrescente ou ambas
        System.out.println("Pretende obter a ordenação da sequência de números por ordem Crescente (1,2,3,...), Decrescente (10,9,8,...) ou Ambas (Crescente e Decrescente) ?");
        Scanner scannerCrescente = new Scanner(System.in);
        String ordenacao = scannerCrescente.nextLine();

        if (Objects.equals(ordenacao, "crescente") || Objects.equals(ordenacao, "Crescente") || Objects.equals(ordenacao, "CRESCENTE")) {
            NumberUtils.ordenarLista(numerosCrescente, true);
            System.out.println("Lista em ordem crescente: " + numerosCrescente);
        } else if (Objects.equals(ordenacao, "ambas") || Objects.equals(ordenacao, "AMBAS") || Objects.equals(ordenacao, "Ambas")) {
            NumberUtils.ordenarLista(numerosCrescente, true);
            System.out.println("Lista em ordem Crescente: " + numerosCrescente);
            NumberUtils.ordenarLista(numerosCrescente, false);
            System.out.println("Lista em ordem Decrescente: " + numerosCrescente);
        } else if (Objects.equals(ordenacao, "decrescente") || Objects.equals(ordenacao, "DECRESCENTE") || Objects.equals(ordenacao, "Decrescente")) {
            // ordena a lista em ordem decrescente
            List<Double> numerosDecrescente = new ArrayList<>(numeros);
            NumberUtils.ordenarLista(numerosDecrescente, false);
            System.out.println("Lista em ordem decrescente: " + numerosDecrescente);
        } else {
            String opcao; //nova variavel para obter a opcao de ordenacao em caso de texto incompativel com opcoes definidas
            do {
                //caso o utilizador insira um texto que nao corresponda às opções
                System.out.println("Opção Inválida.");
                //output de ajuda
                System.out.println("Escrever:\n - 'Crescente' para obter a lista por ordem crescente (1,2,3,...);\n - 'Decrescente' para obter a lista por ordem decrescente (10,9,8,...)\n - 'Ambas' para obter ambas as ordenações (Crescente e Decrescente).");
                Scanner scannerLoop = new Scanner(System.in);
                opcao = scannerLoop.nextLine();
                //o loop pede uma nova inserção de texto ao utilizador e verifica se corresponde a alguma da opções disponíveis
                //caso seja diferente, volta a pedir a inserção de texto até que corresponda
            } while (!Objects.equals(opcao, "decrescente") && !Objects.equals(opcao, "DECRESCENTE") && !Objects.equals(opcao, "Decrescente") &&
                    !Objects.equals(opcao, "CRESCENTE") && !Objects.equals(opcao, "Crescente") && !Objects.equals(opcao, "crescente") &&
                    !Objects.equals(opcao, "ambas") && !Objects.equals(opcao, "AMBAS") && !Objects.equals(opcao, "Ambas"));

            // repete o mesmo processo apenas quando for inserida uma opção válida
            if (Objects.equals(opcao, "crescente") || Objects.equals(opcao, "Crescente") || Objects.equals(opcao, "CRESCENTE")) {
                NumberUtils.ordenarLista(numerosCrescente, true);
                System.out.println("Lista em ordem crescente: " + numerosCrescente);
            } else if (Objects.equals(opcao, "ambas") || Objects.equals(opcao, "AMBAS") || Objects.equals(opcao, "Ambas")) {
                NumberUtils.ordenarLista(numerosCrescente, true);
                System.out.println("Lista em ordem Crescente: " + numerosCrescente);
                NumberUtils.ordenarLista(numerosCrescente, false);
                System.out.println("Lista em ordem Decrescente: " + numerosCrescente);
            } else if (Objects.equals(opcao, "decrescente") || Objects.equals(opcao, "DECRESCENTE") || Objects.equals(opcao, "Decrescente")) {
                List<Double> numerosDecrescente = new ArrayList<>(numeros);
                NumberUtils.ordenarLista(numerosDecrescente, false);
                System.out.println("Lista em ordem decrescente: " + numerosDecrescente);
            }
        }
    }
}
